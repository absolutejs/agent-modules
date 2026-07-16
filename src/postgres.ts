import type {
  AgentMemoryScope,
  AgentMemoryStore,
  StoredAgentMemoryRecord,
} from "./types";
export type AgentMemorySqlResult<Row> = { rows: Row[] };
export type AgentMemorySqlTransaction = {
  query<Row = Record<string, unknown>>(
    sql: string,
    params?: readonly unknown[],
  ): Promise<AgentMemorySqlResult<Row>>;
};
export type AgentMemorySqlClient = AgentMemorySqlTransaction & {
  transaction<Value>(
    work: (tx: AgentMemorySqlTransaction) => Promise<Value>,
  ): Promise<Value>;
};
const safe = (value: string) => {
  if (!/^[a-z_][a-z0-9_]*$/i.test(value))
    throw new Error("Invalid SQL namespace");
  return value;
};
export const agentMemoryPostgresSchemaSql = (schema = "agent_memory") => {
  const ns = safe(schema);
  return `CREATE SCHEMA IF NOT EXISTS ${ns}; CREATE TABLE IF NOT EXISTS ${ns}.records (id text PRIMARY KEY, tenant_id text NOT NULL, namespace text NOT NULL, user_id text NOT NULL DEFAULT '', agent_id text NOT NULL DEFAULT '', run_id text NOT NULL DEFAULT '', memory_key text NOT NULL, version integer NOT NULL, expires_at timestamptz, document jsonb NOT NULL, updated_at timestamptz NOT NULL, UNIQUE (tenant_id,namespace,user_id,agent_id,run_id,memory_key)); CREATE INDEX IF NOT EXISTS agent_memory_expiry_idx ON ${ns}.records (expires_at) WHERE expires_at IS NOT NULL; CREATE INDEX IF NOT EXISTS agent_memory_subject_idx ON ${ns}.records (tenant_id,user_id); CREATE TABLE IF NOT EXISTS ${ns}.requests (request_id text PRIMARY KEY, record_id text NOT NULL REFERENCES ${ns}.records(id) ON DELETE CASCADE, created_at timestamptz NOT NULL DEFAULT now());`;
};
const parts = (scope: AgentMemoryScope) => [
  scope.tenantId,
  scope.namespace,
  scope.userId ?? "",
  scope.agentId ?? "",
  scope.runId ?? "",
];
export const createPostgresAgentMemoryStore = ({
  client,
  schema = "agent_memory",
}: {
  client: AgentMemorySqlClient;
  schema?: string;
}): AgentMemoryStore => {
  const ns = safe(schema);
  const document = (
    row: { document: StoredAgentMemoryRecord | string } | undefined,
  ) =>
    row
      ? typeof row.document === "string"
        ? JSON.parse(row.document)
        : row.document
      : undefined;
  return {
    put: ({ record, requestId, expectedVersion }) =>
      client.transaction(async (tx) => {
        await tx.query(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, [
          requestId,
        ]);
        const prior = document(
          (
            await tx.query<{ document: StoredAgentMemoryRecord | string }>(
              `SELECT r.document FROM ${ns}.requests q JOIN ${ns}.records r ON r.id=q.record_id WHERE q.request_id=$1`,
              [requestId],
            )
          ).rows[0],
        );
        if (prior) return prior;
        const values = [...parts(record.scope), record.key];
        const result =
          expectedVersion === undefined
            ? await tx.query<{ document: StoredAgentMemoryRecord | string }>(
                `INSERT INTO ${ns}.records (id,tenant_id,namespace,user_id,agent_id,run_id,memory_key,version,expires_at,document,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::timestamptz,$10::jsonb,$11::timestamptz) RETURNING document`,
                [
                  record.id,
                  ...values,
                  record.version,
                  record.expiresAt ?? null,
                  JSON.stringify(record),
                  record.updatedAt,
                ],
              )
            : await tx.query<{ document: StoredAgentMemoryRecord | string }>(
                `UPDATE ${ns}.records SET version=$8,expires_at=$9::timestamptz,document=$10::jsonb,updated_at=$11::timestamptz WHERE tenant_id=$1 AND namespace=$2 AND user_id=$3 AND agent_id=$4 AND run_id=$5 AND memory_key=$6 AND version=$7 RETURNING document`,
                [
                  ...values,
                  expectedVersion,
                  record.version,
                  record.expiresAt ?? null,
                  JSON.stringify(record),
                  record.updatedAt,
                ],
              );
        const saved = document(result.rows[0]);
        if (!saved) throw new Error("Agent memory version conflict");
        await tx.query(
          `INSERT INTO ${ns}.requests (request_id,record_id) VALUES ($1,$2)`,
          [requestId, saved.id],
        );
        return saved;
      }),
    get: async (scope, key) =>
      document(
        (
          await client.query<{ document: StoredAgentMemoryRecord | string }>(
            `SELECT document FROM ${ns}.records WHERE tenant_id=$1 AND namespace=$2 AND user_id=$3 AND agent_id=$4 AND run_id=$5 AND memory_key=$6`,
            [...parts(scope), key],
          )
        ).rows[0],
      ),
    getByIds: async (ids) =>
      ids.length
        ? (
            await client.query<{ document: StoredAgentMemoryRecord | string }>(
              `SELECT document FROM ${ns}.records WHERE id = ANY($1::text[])`,
              [ids],
            )
          ).rows.map((row) => document(row)!)
        : [],
    list: async (scope, limit) =>
      (
        await client.query<{ document: StoredAgentMemoryRecord | string }>(
          `SELECT document FROM ${ns}.records WHERE tenant_id=$1 AND namespace=$2 AND user_id=$3 AND agent_id=$4 AND run_id=$5 ORDER BY updated_at DESC LIMIT $6`,
          [...parts(scope), limit],
        )
      ).rows.map((row) => document(row)!),
    delete: async (scope, key) =>
      (
        await client.query(
          `DELETE FROM ${ns}.records WHERE tenant_id=$1 AND namespace=$2 AND user_id=$3 AND agent_id=$4 AND run_id=$5 AND memory_key=$6 RETURNING id`,
          [...parts(scope), key],
        )
      ).rows.length === 1,
    eraseSubject: async ({ tenantId, userId }) =>
      (
        await client.query(
          `DELETE FROM ${ns}.records WHERE tenant_id=$1 AND (user_id=$2 OR document->'createdBy'->>'userId'=$2) RETURNING id`,
          [tenantId, userId],
        )
      ).rows.length,
    prune: async (now, limit) =>
      (
        await client.query(
          `DELETE FROM ${ns}.records WHERE id IN (SELECT id FROM ${ns}.records WHERE expires_at <= $1::timestamptz ORDER BY expires_at LIMIT $2 FOR UPDATE SKIP LOCKED) RETURNING id`,
          [now, limit],
        )
      ).rows.length,
  };
};
