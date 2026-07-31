import { matchesAgent } from "./registry";
import type {
  AgentRecord,
  AgentRegistryStore,
  AgentSearchQuery,
} from "./types";

export type DiscoverySqlResult<Row> = { rows: Row[] };
export type DiscoverySqlClient = {
  query<Row = Record<string, unknown>>(
    sql: string,
    params?: readonly unknown[],
  ): Promise<DiscoverySqlResult<Row>>;
};

const namespace = (value: string) => {
  if (!/^[a-z_][a-z0-9_]*$/i.test(value))
    throw new Error("Invalid SQL namespace");
  return value;
};

export const agentDiscoveryPostgresSchemaSql = (schema = "agent_discovery") => {
  const ns = namespace(schema);
  return `CREATE SCHEMA IF NOT EXISTS ${ns};
CREATE TABLE IF NOT EXISTS ${ns}.agents (
  id text PRIMARY KEY,
  document jsonb NOT NULL,
  verified boolean NOT NULL,
  search_text text NOT NULL,
  first_seen_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS agents_search_idx ON ${ns}.agents USING gin (to_tsvector('simple', search_text));
CREATE INDEX IF NOT EXISTS agents_verified_updated_idx ON ${ns}.agents (verified, updated_at DESC);`;
};

type Row = { document: AgentRecord; verified: boolean };
const textFor = (record: AgentRecord) => {
  const agent = record.signed.document;
  return [
    agent.name,
    agent.description,
    ...(agent.tags ?? []),
    ...(agent.categories ?? []),
    ...agent.capabilities.flatMap((value) => [
      value.id,
      value.title,
      value.description,
      ...(value.tags ?? []),
    ]),
  ].join(" ");
};

export const createPostgresAgentRegistry = ({
  client,
  schema = "agent_discovery",
}: {
  client: DiscoverySqlClient;
  schema?: string;
}): AgentRegistryStore => {
  const ns = namespace(schema);
  return {
    get: async (id) => {
      const result = await client.query<Row>(
        `SELECT document, verified FROM ${ns}.agents WHERE id = $1`,
        [id],
      );
      return result.rows[0]?.document;
    },
    upsert: async (record) => {
      await client.query(
        `INSERT INTO ${ns}.agents (id, document, verified, search_text, first_seen_at, last_seen_at, updated_at)
         VALUES ($1, $2::jsonb, $3, $4, $5::timestamptz, $6::timestamptz, $7::timestamptz)
         ON CONFLICT (id) DO UPDATE SET document = EXCLUDED.document, verified = EXCLUDED.verified,
           search_text = EXCLUDED.search_text, last_seen_at = EXCLUDED.last_seen_at, updated_at = EXCLUDED.updated_at`,
        [
          record.signed.document.id,
          JSON.stringify(record),
          record.verified,
          textFor(record),
          record.firstSeenAt,
          record.lastSeenAt,
          record.signed.document.updatedAt,
        ],
      );
    },
    remove: async (id) =>
      (
        await client.query(
          `DELETE FROM ${ns}.agents WHERE id = $1 RETURNING id`,
          [id],
        )
      ).rows.length > 0,
    list: async (query: AgentSearchQuery) => {
      const limit = Math.max(1, Math.min(query.limit ?? 100, 100));
      const params: unknown[] = [];
      const where: string[] = [];
      if (query.text?.trim()) {
        params.push(query.text.trim());
        where.push(
          `to_tsvector('simple', search_text) @@ plainto_tsquery('simple', $${params.length})`,
        );
      }
      if (query.verifiedOnly) where.push("verified = true");
      params.push(limit);
      const result = await client.query<Row>(
        `SELECT document, verified FROM ${ns}.agents ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY verified DESC, updated_at DESC, id ASC LIMIT $${params.length}`,
        params,
      );
      return result.rows
        .map(({ document }) => document)
        .filter((record) => matchesAgent(record, query));
    },
  };
};
