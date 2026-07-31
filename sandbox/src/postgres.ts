import type { AgentSandboxOperationStore, AgentSandboxResult } from "./types";

export type AgentSandboxSqlResult<Row> = { rows: Row[] };
export type AgentSandboxSqlTransaction = {
  query<Row = Record<string, unknown>>(
    sql: string,
    params?: readonly unknown[],
  ): Promise<AgentSandboxSqlResult<Row>>;
};
export type AgentSandboxSqlClient = AgentSandboxSqlTransaction & {
  transaction<Value>(
    work: (tx: AgentSandboxSqlTransaction) => Promise<Value>,
  ): Promise<Value>;
};
const safe = (value: string) => {
  if (!/^[a-z_][a-z0-9_]*$/i.test(value))
    throw new Error("Invalid SQL namespace");
  return value;
};

export const agentSandboxPostgresSchemaSql = (schema = "agent_sandbox") => {
  const ns = safe(schema);
  return `CREATE SCHEMA IF NOT EXISTS ${ns};
CREATE TABLE IF NOT EXISTS ${ns}.operations (grant_id text NOT NULL, request_id text NOT NULL, capability_id text NOT NULL, state text NOT NULL, result jsonb, created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL, PRIMARY KEY (grant_id, request_id));
CREATE TABLE IF NOT EXISTS ${ns}.capability_usage (grant_id text NOT NULL, capability_id text NOT NULL, uses integer NOT NULL, PRIMARY KEY (grant_id, capability_id));`;
};

export const createPostgresAgentSandboxOperationStore = ({
  client,
  schema = "agent_sandbox",
}: {
  client: AgentSandboxSqlClient;
  schema?: string;
}): AgentSandboxOperationStore => {
  const ns = safe(schema);
  return {
    begin: (input) =>
      client.transaction(async (tx) => {
        const existing = (
          await tx.query<{ state: string; result?: AgentSandboxResult }>(
            `SELECT state,result FROM ${ns}.operations WHERE grant_id=$1 AND request_id=$2 FOR UPDATE`,
            [input.grantId, input.requestId],
          )
        ).rows[0];
        if (existing?.state === "completed" && existing.result)
          return { state: "completed" as const, result: existing.result };
        if (existing) return { state: "in_progress" as const };
        await tx.query(
          `INSERT INTO ${ns}.capability_usage (grant_id,capability_id,uses) VALUES ($1,$2,0) ON CONFLICT DO NOTHING`,
          [input.grantId, input.capabilityId],
        );
        const usage =
          (
            await tx.query<{ uses: number }>(
              `SELECT uses FROM ${ns}.capability_usage WHERE grant_id=$1 AND capability_id=$2 FOR UPDATE`,
              [input.grantId, input.capabilityId],
            )
          ).rows[0]?.uses ?? 0;
        if (input.maxUses !== undefined && usage >= input.maxUses)
          return { state: "limit_exceeded" as const };
        await tx.query(
          `UPDATE ${ns}.capability_usage SET uses=uses+1 WHERE grant_id=$1 AND capability_id=$2`,
          [input.grantId, input.capabilityId],
        );
        await tx.query(
          `INSERT INTO ${ns}.operations (grant_id,request_id,capability_id,state,created_at,updated_at) VALUES ($1,$2,$3,'in_progress',$4::timestamptz,$4::timestamptz)`,
          [input.grantId, input.requestId, input.capabilityId, input.now],
        );
        return { state: "acquired" as const };
      }),
    complete: async (input) =>
      (
        await client.query(
          `UPDATE ${ns}.operations SET state='completed',result=$3::jsonb,updated_at=$4::timestamptz WHERE grant_id=$1 AND request_id=$2 AND state='in_progress' RETURNING request_id`,
          [
            input.grantId,
            input.requestId,
            JSON.stringify(input.result),
            input.now,
          ],
        )
      ).rows.length === 1,
    fail: async (input) => {
      await client.query(
        `UPDATE ${ns}.operations SET state='failed' WHERE grant_id=$1 AND request_id=$2 AND state='in_progress'`,
        [input.grantId, input.requestId],
      );
    },
  };
};
