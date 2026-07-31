import type {
  AgentReputationStore,
  StoredAgentReputationEvidence,
} from "./types";

export type AgentReputationSqlClient = {
  query: <Row = Record<string, unknown>>(
    sql: string,
    values?: unknown[],
  ) => Promise<{ rows: Row[] }>;
};

const identifier = (value: string) => {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(value))
    throw new Error("Invalid PostgreSQL schema");
  return `"${value}"`;
};

export const agentReputationPostgresSchemaSql = (
  schema = "agent_reputation",
) => {
  const ns = identifier(schema);
  return `CREATE SCHEMA IF NOT EXISTS ${ns}; CREATE TABLE IF NOT EXISTS ${ns}.evidence (evidence_id text PRIMARY KEY, subject text NOT NULL, scope text NOT NULL, issuer text NOT NULL, issued_at timestamptz NOT NULL, expires_at timestamptz, revoked_at timestamptz, document jsonb NOT NULL); CREATE INDEX IF NOT EXISTS agent_reputation_subject_scope_idx ON ${ns}.evidence (subject,scope,issued_at DESC); CREATE INDEX IF NOT EXISTS agent_reputation_expiry_idx ON ${ns}.evidence (expires_at) WHERE expires_at IS NOT NULL;`;
};

export const createPostgresAgentReputationStore = (options: {
  client: AgentReputationSqlClient;
  schema?: string;
}): AgentReputationStore => {
  const ns = identifier(options.schema ?? "agent_reputation");
  const document = (row: { document: StoredAgentReputationEvidence }) =>
    row.document;
  return {
    get: async (id) =>
      (
        await options.client.query<{ document: StoredAgentReputationEvidence }>(
          `SELECT document || CASE WHEN revoked_at IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('revokedAt',revoked_at) END AS document FROM ${ns}.evidence WHERE evidence_id=$1`,
          [id],
        )
      ).rows[0]?.document,
    list: async (subject, scope) =>
      (
        await options.client.query<{ document: StoredAgentReputationEvidence }>(
          `SELECT document || CASE WHEN revoked_at IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('revokedAt',revoked_at) END AS document FROM ${ns}.evidence WHERE subject=$1 AND scope=$2 ORDER BY issued_at`,
          [subject, scope],
        )
      ).rows.map(document),
    put: async (item) => {
      await options.client.query(
        `INSERT INTO ${ns}.evidence (evidence_id,subject,scope,issuer,issued_at,expires_at,document) VALUES ($1,$2,$3,$4,$5::timestamptz,$6::timestamptz,$7::jsonb)`,
        [
          item.evidenceId,
          item.subject,
          item.scope,
          item.issuer,
          item.issuedAt,
          item.expiresAt ?? null,
          JSON.stringify(item),
        ],
      );
    },
    revoke: async (id, revokedAt) =>
      (
        await options.client.query(
          `UPDATE ${ns}.evidence SET revoked_at=$2::timestamptz WHERE evidence_id=$1 AND revoked_at IS NULL RETURNING evidence_id`,
          [id, revokedAt],
        )
      ).rows.length === 1,
  };
};
