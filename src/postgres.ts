import type { AgentRun, AgentRuntimeStore, AgentStep } from "./types";

export type AgentRuntimeSqlResult<Row> = { rows: Row[] };
export type AgentRuntimeSqlTransaction = {
  query<Row = Record<string, unknown>>(
    sql: string,
    params?: readonly unknown[],
  ): Promise<AgentRuntimeSqlResult<Row>>;
};
export type AgentRuntimeSqlClient = AgentRuntimeSqlTransaction & {
  transaction<Value>(
    work: (tx: AgentRuntimeSqlTransaction) => Promise<Value>,
  ): Promise<Value>;
};

const safe = (value: string) => {
  if (!/^[a-z_][a-z0-9_]*$/i.test(value))
    throw new Error("Invalid SQL namespace");
  return value;
};

export const agentRuntimePostgresSchemaSql = (schema = "agent_runtime") => {
  const ns = safe(schema);
  return `CREATE SCHEMA IF NOT EXISTS ${ns};
CREATE TABLE IF NOT EXISTS ${ns}.runs (
  id text PRIMARY KEY,
  document jsonb NOT NULL,
  status text NOT NULL,
  version integer NOT NULL,
  wake_at timestamptz,
  lease_owner text,
  lease_expires_at timestamptz,
  cancel_requested_at timestamptz,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS agent_runs_due_idx ON ${ns}.runs (status, wake_at, lease_expires_at, created_at);
CREATE INDEX IF NOT EXISTS agent_runs_actor_idx ON ${ns}.runs ((document->'actor'->>'tenantId'), (document->'actor'->>'userId'), created_at DESC);
CREATE TABLE IF NOT EXISTS ${ns}.steps (
  run_id text NOT NULL REFERENCES ${ns}.runs(id) ON DELETE CASCADE,
  sequence integer NOT NULL,
  id text NOT NULL UNIQUE,
  kind text NOT NULL,
  idempotency_key text,
  document jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (run_id, sequence)
);
CREATE UNIQUE INDEX IF NOT EXISTS agent_steps_idempotency_idx ON ${ns}.steps (run_id, idempotency_key, kind) WHERE idempotency_key IS NOT NULL;`;
};

type RunRow = { document: AgentRun };
type StepRow = { document: AgentStep };
const saved = (run: AgentRun) => [
  JSON.stringify(run),
  run.status,
  run.version,
  run.wakeAt ?? null,
  run.leaseOwner ?? null,
  run.leaseExpiresAt ?? null,
  run.cancelRequestedAt ?? null,
  run.updatedAt,
  run.id,
];

export const createPostgresAgentRuntimeStore = ({
  client,
  schema = "agent_runtime",
}: {
  client: AgentRuntimeSqlClient;
  schema?: string;
}): AgentRuntimeStore => {
  const ns = safe(schema);
  const update = async (tx: AgentRuntimeSqlTransaction, run: AgentRun) => {
    const result = await tx.query<RunRow>(
      `UPDATE ${ns}.runs SET document=$1::jsonb,status=$2,version=$3,wake_at=$4::timestamptz,lease_owner=$5,lease_expires_at=$6::timestamptz,cancel_requested_at=$7::timestamptz,updated_at=$8::timestamptz WHERE id=$9 RETURNING document`,
      saved(run),
    );
    return result.rows[0]?.document;
  };
  return {
    createRun: async (run) => {
      await client.query(
        `INSERT INTO ${ns}.runs (id,document,status,version,wake_at,lease_owner,lease_expires_at,cancel_requested_at,created_at,updated_at) VALUES ($1,$2::jsonb,$3,$4,$5,$6,$7,$8,$9::timestamptz,$10::timestamptz)`,
        [
          run.id,
          JSON.stringify(run),
          run.status,
          run.version,
          null,
          null,
          null,
          null,
          run.createdAt,
          run.updatedAt,
        ],
      );
    },
    getRun: async (id) =>
      (
        await client.query<RunRow>(
          `SELECT document FROM ${ns}.runs WHERE id=$1`,
          [id],
        )
      ).rows[0]?.document,
    listSteps: async (runId) =>
      (
        await client.query<StepRow>(
          `SELECT document FROM ${ns}.steps WHERE run_id=$1 ORDER BY sequence`,
          [runId],
        )
      ).rows.map((row) => row.document),
    claimDue: async ({ workerId, now, leaseExpiresAt }) =>
      client.transaction(async (tx) => {
        const result = await tx.query<RunRow>(
          `SELECT document FROM ${ns}.runs WHERE cancel_requested_at IS NULL AND (status='queued' OR (status='waiting' AND wake_at <= $1::timestamptz) OR (status='running' AND lease_expires_at <= $1::timestamptz)) ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1`,
          [now],
        );
        const run = result.rows[0]?.document;
        if (!run) return undefined;
        return update(tx, {
          ...run,
          status: "running",
          wakeAt: undefined,
          leaseOwner: workerId,
          leaseExpiresAt,
          version: run.version + 1,
          updatedAt: now,
        });
      }),
    heartbeat: async ({
      runId,
      workerId,
      expectedVersion,
      leaseExpiresAt,
      now,
    }) =>
      client.transaction(async (tx) => {
        const run = (
          await tx.query<RunRow>(
            `SELECT document FROM ${ns}.runs WHERE id=$1 AND version=$2 AND lease_owner=$3 AND status='running' FOR UPDATE`,
            [runId, expectedVersion, workerId],
          )
        ).rows[0]?.document;
        return run
          ? update(tx, {
              ...run,
              leaseExpiresAt,
              version: run.version + 1,
              updatedAt: now,
            })
          : undefined;
      }),
    appendStep: async ({ runId, workerId, expectedVersion, step, now }) =>
      client.transaction(async (tx) => {
        const run = (
          await tx.query<RunRow>(
            `SELECT document FROM ${ns}.runs WHERE id=$1 AND version=$2 AND lease_owner=$3 AND status='running' FOR UPDATE`,
            [runId, expectedVersion, workerId],
          )
        ).rows[0]?.document;
        if (!run) return undefined;
        const keys = Object.keys(step.usage) as Array<keyof typeof step.usage>;
        const exceeded = keys.find(
          (key) =>
            run.budget[key] !== undefined &&
            run.usage[key] + step.usage[key] > (run.budget[key] ?? 0),
        );
        if (exceeded) throw new Error(`Agent budget exceeded: ${exceeded}`);
        const inserted = await tx.query(
          `INSERT INTO ${ns}.steps (run_id,sequence,id,kind,idempotency_key,document,created_at) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::timestamptz) ON CONFLICT DO NOTHING RETURNING id`,
          [
            runId,
            step.sequence,
            step.id,
            step.kind,
            step.idempotencyKey ?? null,
            JSON.stringify(step),
            step.createdAt,
          ],
        );
        if (!inserted.rows.length) return undefined;
        const usage = Object.fromEntries(
          keys.map((key) => [key, run.usage[key] + step.usage[key]]),
        ) as AgentRun["usage"];
        return update(tx, {
          ...run,
          usage,
          version: run.version + 1,
          updatedAt: now,
        });
      }),
    transition: async ({
      runId,
      workerId,
      expectedVersion,
      status,
      now,
      output,
      checkpoint,
      wakeAt,
      error,
    }) =>
      client.transaction(async (tx) => {
        const params: unknown[] = [runId, expectedVersion];
        const owner = workerId ? ` AND lease_owner=$3` : "";
        if (workerId) params.push(workerId);
        const run = (
          await tx.query<RunRow>(
            `SELECT document FROM ${ns}.runs WHERE id=$1 AND version=$2${owner} FOR UPDATE`,
            params,
          )
        ).rows[0]?.document;
        if (!run) return undefined;
        return update(tx, {
          ...run,
          status,
          version: run.version + 1,
          updatedAt: now,
          ...(output === undefined ? {} : { output }),
          ...(checkpoint === undefined ? {} : { checkpoint }),
          ...(wakeAt === undefined ? {} : { wakeAt }),
          ...(error === undefined ? {} : { error }),
          ...(status === "running"
            ? {}
            : { leaseOwner: undefined, leaseExpiresAt: undefined }),
        });
      }),
    requestCancel: async ({ runId, now }) =>
      client.transaction(async (tx) => {
        const run = (
          await tx.query<RunRow>(
            `SELECT document FROM ${ns}.runs WHERE id=$1 FOR UPDATE`,
            [runId],
          )
        ).rows[0]?.document;
        if (!run) return undefined;
        if (
          ["completed", "failed", "cancelled", "handed_off"].includes(
            run.status,
          )
        )
          return run;
        const canCancelImmediately = run.status !== "running";
        return update(tx, {
          ...run,
          status: canCancelImmediately ? "cancelled" : run.status,
          cancelRequestedAt: now,
          version: run.version + 1,
          updatedAt: now,
          ...(canCancelImmediately
            ? {
                leaseOwner: undefined,
                leaseExpiresAt: undefined,
                wakeAt: undefined,
              }
            : {}),
        });
      }),
  };
};
