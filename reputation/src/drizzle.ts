import { and, asc, eq, isNull } from "drizzle-orm";
import {
  customType,
  index,
  pgTable,
  text,
  timestamp,
  type PgAsyncDatabase,
} from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-typebox";
import type {
  AgentReputationStore,
  StoredAgentReputationEvidence,
} from "./types";

const portableJsonb = customType<{
  data: StoredAgentReputationEvidence;
  driverData: unknown;
}>({
  dataType: () => "jsonb",
  fromDriver: (value) =>
    (typeof value === "string"
      ? JSON.parse(value)
      : value) as StoredAgentReputationEvidence,
  toDriver: (value) => JSON.stringify(value),
});

export const agentReputationEvidence = pgTable(
  "agent_reputation_evidence",
  {
    document: portableJsonb().notNull(),
    evidenceId: text("evidence_id").primaryKey(),
    expiresAt: timestamp("expires_at", {
      mode: "string",
      withTimezone: true,
    }),
    issuedAt: timestamp("issued_at", {
      mode: "string",
      withTimezone: true,
    }).notNull(),
    issuer: text().notNull(),
    revokedAt: timestamp("revoked_at", {
      mode: "string",
      withTimezone: true,
    }),
    scope: text().notNull(),
    subject: text().notNull(),
  },
  (table) => [
    index("agent_reputation_subject_scope_idx").on(
      table.subject,
      table.scope,
      table.issuedAt.desc(),
    ),
    index("agent_reputation_expiry_idx")
      .on(table.expiresAt)
      .where(isNull(table.revokedAt)),
  ],
);

export const agentReputationDrizzleSchema = { agentReputationEvidence };
export const AgentReputationEvidenceInsertSchema = createInsertSchema(
  agentReputationEvidence,
);
export const AgentReputationEvidenceSelectSchema = createSelectSchema(
  agentReputationEvidence,
);

type AnyPgDatabase = PgAsyncDatabase<any, any>;

const fromRow = (row: typeof agentReputationEvidence.$inferSelect) => ({
  ...row.document,
  ...(row.revokedAt
    ? { revokedAt: new Date(row.revokedAt).toISOString() }
    : {}),
});

export const createDrizzleAgentReputationStore = <
  DB extends AnyPgDatabase,
>(options: {
  db: DB;
}): AgentReputationStore => ({
  get: async (evidenceId) => {
    const [row] = await options.db
      .select()
      .from(agentReputationEvidence)
      .where(eq(agentReputationEvidence.evidenceId, evidenceId))
      .limit(1);

    return row ? fromRow(row) : undefined;
  },
  list: async (subject, scope) =>
    (
      await options.db
        .select()
        .from(agentReputationEvidence)
        .where(
          and(
            eq(agentReputationEvidence.subject, subject),
            eq(agentReputationEvidence.scope, scope),
          ),
        )
        .orderBy(asc(agentReputationEvidence.issuedAt))
    ).map(fromRow),
  put: async (evidence) => {
    await options.db.insert(agentReputationEvidence).values({
      document: evidence,
      evidenceId: evidence.evidenceId,
      expiresAt: evidence.expiresAt,
      issuedAt: evidence.issuedAt,
      issuer: evidence.issuer,
      revokedAt: evidence.revokedAt,
      scope: evidence.scope,
      subject: evidence.subject,
    });
  },
  revoke: async (evidenceId, revokedAt) =>
    (
      await options.db
        .update(agentReputationEvidence)
        .set({ revokedAt })
        .where(
          and(
            eq(agentReputationEvidence.evidenceId, evidenceId),
            isNull(agentReputationEvidence.revokedAt),
          ),
        )
        .returning({ evidenceId: agentReputationEvidence.evidenceId })
    ).length === 1,
});
