import { and, desc, eq, isNotNull, isNull, lte, or, sql } from "drizzle-orm";
import {
  customType,
  index,
  integer,
  pgSchema,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  type PgAsyncDatabase,
} from "drizzle-orm/pg-core";
import type { AgentRun, AgentRuntimeStore, AgentStep } from "./types";

type AnyPgDatabase = PgAsyncDatabase<any, any>;
const portableJsonb = customType<{ data: unknown; driverData: unknown }>({
  dataType: () => "jsonb",
  fromDriver: (value) =>
    typeof value === "string" ? JSON.parse(value) : value,
  toDriver: (value) => JSON.stringify(value),
});
const encodedJsonb = <Value>(value: Value) =>
  sql<Value>`${JSON.stringify(value)}::text::jsonb`;

const namespaceOf = (value: string) => {
  if (!/^[a-z_][a-z0-9_]*$/i.test(value))
    throw new Error("Invalid SQL namespace");
  return value;
};

export const agentRuntimeDrizzleSchema = (namespace = "agent_runtime") => {
  const schema = pgSchema(namespaceOf(namespace));
  const runs = schema.table(
    "runs",
    {
      cancel_requested_at: timestamp({ mode: "date", withTimezone: true }),
      created_at: timestamp({ mode: "date", withTimezone: true }).notNull(),
      document: portableJsonb().$type<AgentRun>().notNull(),
      id: text().primaryKey(),
      lease_expires_at: timestamp({ mode: "date", withTimezone: true }),
      lease_owner: text(),
      status: text().$type<AgentRun["status"]>().notNull(),
      updated_at: timestamp({ mode: "date", withTimezone: true }).notNull(),
      version: integer().notNull(),
      wake_at: timestamp({ mode: "date", withTimezone: true }),
    },
    (table) => [
      index("agent_runs_due_idx").on(
        table.status,
        table.wake_at,
        table.lease_expires_at,
        table.created_at,
      ),
      index("agent_runs_actor_idx").on(
        sql`((${table.document}->'actor'->>'tenantId'))`,
        sql`((${table.document}->'actor'->>'userId'))`,
        table.created_at.desc(),
      ),
    ],
  );
  const steps = schema.table(
    "steps",
    {
      created_at: timestamp({ mode: "date", withTimezone: true }).notNull(),
      document: portableJsonb().$type<AgentStep>().notNull(),
      id: text().notNull().unique(),
      idempotency_key: text(),
      kind: text().notNull(),
      run_id: text()
        .notNull()
        .references(() => runs.id, { onDelete: "cascade" }),
      sequence: integer().notNull(),
    },
    (table) => [
      primaryKey({ columns: [table.run_id, table.sequence] }),
      uniqueIndex("agent_steps_idempotency_idx")
        .on(table.run_id, table.idempotency_key, table.kind)
        .where(isNotNull(table.idempotency_key)),
    ],
  );

  return { runs, steps };
};

export const createDrizzleAgentRuntimeStore = <DB extends AnyPgDatabase>(
  db: DB,
  options: { namespace?: string } = {},
): AgentRuntimeStore => {
  const { runs, steps } = agentRuntimeDrizzleSchema(options.namespace);
  const update = async (database: AnyPgDatabase, run: AgentRun) =>
    (
      await database
        .update(runs)
        .set({
          cancel_requested_at: run.cancelRequestedAt
            ? new Date(run.cancelRequestedAt)
            : null,
          document: encodedJsonb(run),
          lease_expires_at: run.leaseExpiresAt
            ? new Date(run.leaseExpiresAt)
            : null,
          lease_owner: run.leaseOwner ?? null,
          status: run.status,
          updated_at: new Date(run.updatedAt),
          version: run.version,
          wake_at: run.wakeAt ? new Date(run.wakeAt) : null,
        })
        .where(eq(runs.id, run.id))
        .returning({ document: runs.document })
    )[0]?.document;
  const lockedRun = async (
    database: AnyPgDatabase,
    conditions: ReturnType<typeof and>,
  ) =>
    (
      await database
        .select({ document: runs.document })
        .from(runs)
        .where(conditions)
        .for("update")
        .limit(1)
    )[0]?.document;

  return {
    createRun: async (run) => {
      await db.insert(runs).values({
        cancel_requested_at: null,
        created_at: new Date(run.createdAt),
        document: encodedJsonb(run),
        id: run.id,
        lease_expires_at: null,
        lease_owner: null,
        status: run.status,
        updated_at: new Date(run.updatedAt),
        version: run.version,
        wake_at: null,
      });
    },
    getRun: async (id) =>
      (
        await db
          .select({ document: runs.document })
          .from(runs)
          .where(eq(runs.id, id))
          .limit(1)
      )[0]?.document,
    listRuns: async ({ limit = 50, status, tenantId, userId } = {}) => {
      return (
        await db
          .select({ document: runs.document })
          .from(runs)
          .where(
            and(
              status ? eq(runs.status, status) : undefined,
              tenantId
                ? eq(
                    sql<string>`${runs.document}->'actor'->>'tenantId'`,
                    tenantId,
                  )
                : undefined,
              userId
                ? eq(sql<string>`${runs.document}->'actor'->>'userId'`, userId)
                : undefined,
            ),
          )
          .orderBy(desc(runs.created_at), desc(runs.id))
          .limit(Math.max(1, Math.min(limit, 200)))
      ).map(({ document }) => document);
    },
    listSteps: async (runId) =>
      (
        await db
          .select({ document: steps.document })
          .from(steps)
          .where(eq(steps.run_id, runId))
          .orderBy(steps.sequence)
      ).map(({ document }) => document),
    claimDue: ({ workerId, now, leaseExpiresAt }) =>
      db.transaction(async (transaction) => {
        const instant = new Date(now);
        const run = (
          await transaction
            .select({ document: runs.document })
            .from(runs)
            .where(
              and(
                isNull(runs.cancel_requested_at),
                or(
                  eq(runs.status, "queued"),
                  and(eq(runs.status, "waiting"), lte(runs.wake_at, instant)),
                  and(
                    eq(runs.status, "running"),
                    lte(runs.lease_expires_at, instant),
                  ),
                ),
              ),
            )
            .orderBy(runs.created_at)
            .for("update", { skipLocked: true })
            .limit(1)
        )[0]?.document;
        return run
          ? update(transaction, {
              ...run,
              leaseExpiresAt,
              leaseOwner: workerId,
              status: "running",
              updatedAt: now,
              version: run.version + 1,
              wakeAt: undefined,
            })
          : undefined;
      }),
    heartbeat: ({ runId, workerId, expectedVersion, leaseExpiresAt, now }) =>
      db.transaction(async (transaction) => {
        const run = await lockedRun(
          transaction,
          and(
            eq(runs.id, runId),
            eq(runs.version, expectedVersion),
            eq(runs.lease_owner, workerId),
            eq(runs.status, "running"),
          ),
        );
        return run
          ? update(transaction, {
              ...run,
              leaseExpiresAt,
              updatedAt: now,
              version: run.version + 1,
            })
          : undefined;
      }),
    appendStep: ({ runId, workerId, expectedVersion, step, now }) =>
      db.transaction(async (transaction) => {
        const run = await lockedRun(
          transaction,
          and(
            eq(runs.id, runId),
            eq(runs.version, expectedVersion),
            eq(runs.lease_owner, workerId),
            eq(runs.status, "running"),
          ),
        );
        if (!run) return undefined;
        const keys = Object.keys(step.usage) as Array<keyof typeof step.usage>;
        const exceeded = keys.find(
          (key) =>
            run.budget[key] !== undefined &&
            run.usage[key] + step.usage[key] > (run.budget[key] ?? 0),
        );
        if (exceeded) throw new Error(`Agent budget exceeded: ${exceeded}`);
        const inserted = await transaction
          .insert(steps)
          .values({
            created_at: new Date(step.createdAt),
            document: encodedJsonb(step),
            id: step.id,
            idempotency_key: step.idempotencyKey ?? null,
            kind: step.kind,
            run_id: runId,
            sequence: step.sequence,
          })
          .onConflictDoNothing()
          .returning({ id: steps.id });
        if (inserted.length === 0) return undefined;
        const usage = Object.fromEntries(
          keys.map((key) => [key, run.usage[key] + step.usage[key]]),
        ) as AgentRun["usage"];
        return update(transaction, {
          ...run,
          updatedAt: now,
          usage,
          version: run.version + 1,
        });
      }),
    transition: ({
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
      db.transaction(async (transaction) => {
        const run = await lockedRun(
          transaction,
          and(
            eq(runs.id, runId),
            eq(runs.version, expectedVersion),
            workerId ? eq(runs.lease_owner, workerId) : undefined,
          ),
        );
        return run
          ? update(transaction, {
              ...run,
              status,
              updatedAt: now,
              version: run.version + 1,
              ...(output === undefined ? {} : { output }),
              ...(checkpoint === undefined ? {} : { checkpoint }),
              ...(wakeAt === undefined ? {} : { wakeAt }),
              ...(error === undefined ? {} : { error }),
              ...(status === "running"
                ? {}
                : { leaseExpiresAt: undefined, leaseOwner: undefined }),
            })
          : undefined;
      }),
    requestCancel: ({ runId, now }) =>
      db.transaction(async (transaction) => {
        const run = await lockedRun(transaction, and(eq(runs.id, runId)));
        if (!run) return undefined;
        if (
          ["completed", "failed", "cancelled", "handed_off"].includes(
            run.status,
          )
        )
          return run;
        const canCancelImmediately = run.status !== "running";
        return update(transaction, {
          ...run,
          cancelRequestedAt: now,
          status: canCancelImmediately ? "cancelled" : run.status,
          updatedAt: now,
          version: run.version + 1,
          ...(canCancelImmediately
            ? {
                leaseExpiresAt: undefined,
                leaseOwner: undefined,
                wakeAt: undefined,
              }
            : {}),
        });
      }),
  };
};
