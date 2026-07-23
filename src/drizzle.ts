import { and, desc, eq, inArray, lte, sql } from "drizzle-orm";
import {
  customType,
  index,
  integer,
  pgSchema,
  text,
  timestamp,
  uniqueIndex,
  type PgAsyncDatabase,
} from "drizzle-orm/pg-core";
import type {
  AgentMemoryScope,
  AgentMemoryStore,
  StoredAgentMemoryRecord,
} from "./types";

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
const scopeParts = (scope: AgentMemoryScope) => ({
  agentId: scope.agentId ?? "",
  namespace: scope.namespace,
  runId: scope.runId ?? "",
  tenantId: scope.tenantId,
  userId: scope.userId ?? "",
});

export const agentMemoryDrizzleSchema = (namespace = "agent_memory") => {
  const schema = pgSchema(namespaceOf(namespace));
  const records = schema.table(
    "records",
    {
      agent_id: text().notNull().default(""),
      document: portableJsonb().$type<StoredAgentMemoryRecord>().notNull(),
      expires_at: timestamp({ mode: "date", withTimezone: true }),
      id: text().primaryKey(),
      memory_key: text().notNull(),
      namespace: text().notNull(),
      run_id: text().notNull().default(""),
      tenant_id: text().notNull(),
      updated_at: timestamp({ mode: "date", withTimezone: true }).notNull(),
      user_id: text().notNull().default(""),
      version: integer().notNull(),
    },
    (table) => [
      uniqueIndex("agent_memory_scope_key_idx").on(
        table.tenant_id,
        table.namespace,
        table.user_id,
        table.agent_id,
        table.run_id,
        table.memory_key,
      ),
      index("agent_memory_expiry_idx")
        .on(table.expires_at)
        .where(sql`${table.expires_at} is not null`),
      index("agent_memory_subject_idx").on(table.tenant_id, table.user_id),
    ],
  );
  const requests = schema.table("requests", {
    created_at: timestamp({ mode: "date", withTimezone: true })
      .notNull()
      .defaultNow(),
    record_id: text()
      .notNull()
      .references(() => records.id, { onDelete: "cascade" }),
    request_id: text().primaryKey(),
  });

  return { records, requests };
};

export const createDrizzleAgentMemoryStore = <DB extends AnyPgDatabase>(
  db: DB,
  options: { namespace?: string } = {},
): AgentMemoryStore => {
  const { records, requests } = agentMemoryDrizzleSchema(options.namespace);
  const conditions = (scope: AgentMemoryScope) => {
    const parts = scopeParts(scope);
    return and(
      eq(records.tenant_id, parts.tenantId),
      eq(records.namespace, parts.namespace),
      eq(records.user_id, parts.userId),
      eq(records.agent_id, parts.agentId),
      eq(records.run_id, parts.runId),
    );
  };

  return {
    delete: async (scope, key) =>
      (
        await db
          .delete(records)
          .where(and(conditions(scope), eq(records.memory_key, key)))
          .returning({ id: records.id })
      ).length === 1,
    eraseSubject: async ({ tenantId, userId }) => {
      const candidates = await db
        .select({
          createdBy: records.document,
          id: records.id,
          userId: records.user_id,
        })
        .from(records)
        .where(eq(records.tenant_id, tenantId));
      const ids = candidates
        .filter(
          (row) =>
            row.userId === userId || row.createdBy.createdBy.userId === userId,
        )
        .map(({ id }) => id);
      if (ids.length === 0) return 0;
      return (
        await db
          .delete(records)
          .where(inArray(records.id, ids))
          .returning({ id: records.id })
      ).length;
    },
    get: async (scope, key) =>
      (
        await db
          .select({ document: records.document })
          .from(records)
          .where(and(conditions(scope), eq(records.memory_key, key)))
          .limit(1)
      )[0]?.document,
    getByIds: async (ids) =>
      ids.length === 0
        ? []
        : (
            await db
              .select({ document: records.document })
              .from(records)
              .where(inArray(records.id, [...ids]))
          ).map(({ document }) => document),
    list: async (scope, limit) =>
      (
        await db
          .select({ document: records.document })
          .from(records)
          .where(conditions(scope))
          .orderBy(desc(records.updated_at))
          .limit(limit)
      ).map(({ document }) => document),
    listRecords: async ({ tenantId, limit }) =>
      (
        await db
          .select({ document: records.document })
          .from(records)
          .where(tenantId ? eq(records.tenant_id, tenantId) : undefined)
          .orderBy(desc(records.updated_at))
          .limit(Math.max(1, Math.min(limit, 200)))
      ).map(({ document }) => document),
    prune: (now, limit) =>
      db.transaction(async (transaction) => {
        const expired = await transaction
          .select({ id: records.id })
          .from(records)
          .where(lte(records.expires_at, new Date(now)))
          .orderBy(records.expires_at)
          .limit(limit)
          .for("update", { skipLocked: true });
        if (expired.length === 0) return 0;
        return (
          await transaction
            .delete(records)
            .where(
              inArray(
                records.id,
                expired.map(({ id }) => id),
              ),
            )
            .returning({ id: records.id })
        ).length;
      }),
    put: ({ record, requestId, expectedVersion }) =>
      db.transaction(async (transaction) => {
        await transaction.execute(
          sql`select pg_advisory_xact_lock(hashtextextended(${requestId}, 0))`,
        );
        const [prior] = await transaction
          .select({ document: records.document })
          .from(requests)
          .innerJoin(records, eq(records.id, requests.record_id))
          .where(eq(requests.request_id, requestId))
          .limit(1);
        if (prior) return prior.document;
        const parts = scopeParts(record.scope);
        const values = {
          agent_id: parts.agentId,
          document: encodedJsonb(record),
          expires_at: record.expiresAt ? new Date(record.expiresAt) : null,
          id: record.id,
          memory_key: record.key,
          namespace: parts.namespace,
          run_id: parts.runId,
          tenant_id: parts.tenantId,
          updated_at: new Date(record.updatedAt),
          user_id: parts.userId,
          version: record.version,
        };
        const saved =
          expectedVersion === undefined
            ? await transaction
                .insert(records)
                .values(values)
                .returning({ document: records.document })
            : await transaction
                .update(records)
                .set({
                  document: encodedJsonb(record),
                  expires_at: values.expires_at,
                  updated_at: values.updated_at,
                  version: record.version,
                })
                .where(
                  and(
                    conditions(record.scope),
                    eq(records.memory_key, record.key),
                    eq(records.version, expectedVersion),
                  ),
                )
                .returning({ document: records.document });
        const document = saved[0]?.document;
        if (!document) throw new Error("Agent memory version conflict");
        await transaction.insert(requests).values({
          record_id: document.id,
          request_id: requestId,
        });
        return document;
      }),
  };
};
