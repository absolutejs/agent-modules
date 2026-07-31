import type { AgentControlPlane } from "@absolutejs/agency";
import { and, eq, isNull, lte, sql } from "drizzle-orm";
import {
  bigint,
  customType,
  pgSchema,
  text,
  type PgAsyncDatabase,
} from "drizzle-orm/pg-core";

export * from "./console";
export * from "./playground";

export type Operator = { id: string; scopes: readonly string[] };
export type OperationRecord = {
  digest: string;
  key: string;
  leaseUntil: number;
  response?: unknown;
};
export type OperationStore = {
  claim: (
    key: string,
    digest: string,
    now: number,
    leaseMs: number,
  ) => Promise<{ acquired: boolean; response?: unknown }>;
  complete: (
    key: string,
    digest: string,
    response: unknown,
  ) => Promise<boolean>;
};
export const createMemoryOperationStore = (): OperationStore => {
  const rows = new Map<string, OperationRecord>();
  return {
    claim: async (key, digest, now, leaseMs) => {
      const row = rows.get(key);
      if (row?.digest !== undefined && row.digest !== digest)
        throw new Error("Idempotency key reused with different input");
      if (row?.response !== undefined)
        return { acquired: false, response: structuredClone(row.response) };
      if (row && row.leaseUntil > now) return { acquired: false };
      rows.set(key, { digest, key, leaseUntil: now + leaseMs });
      return { acquired: true };
    },
    complete: async (key, digest, response) => {
      const row = rows.get(key);
      if (!row || row.digest !== digest) return false;
      rows.set(key, { ...row, response: structuredClone(response) });
      return true;
    },
  };
};
type AnyPgDatabase = PgAsyncDatabase<any, any>;
const portableJsonb = customType<{ data: unknown; driverData: unknown }>({
  dataType: () => "jsonb",
  fromDriver: (value) =>
    typeof value === "string" ? JSON.parse(value) : value,
  toDriver: (value) => JSON.stringify(value),
});
const encodedJsonb = <Value>(value: Value) =>
  sql<Value>`${JSON.stringify(value)}::text::jsonb`;
const nsOf = (value: string) => {
  if (!/^[a-z_][a-z0-9_]*$/.test(value))
    throw new Error("Control namespace must be a simple identifier");
  return value;
};
export const agentControlDrizzleSchema = (namespace = "agent_control") => {
  const schema = pgSchema(nsOf(namespace));
  const operations = schema.table("operations", {
    digest: text().notNull(),
    lease_until: bigint({ mode: "number" }).notNull(),
    operation_key: text().primaryKey(),
    response: portableJsonb(),
  });
  return { operations };
};
export const createDrizzleOperationStore = <DB extends AnyPgDatabase>(
  db: DB,
  options: { namespace?: string } = {},
): OperationStore => {
  const { operations } = agentControlDrizzleSchema(options.namespace);
  return {
    claim: async (key, digest, now, leaseMs) => {
      const [claimed] = await db
        .insert(operations)
        .values({
          digest,
          lease_until: now + leaseMs,
          operation_key: key,
        })
        .onConflictDoUpdate({
          set: { lease_until: now + leaseMs },
          setWhere: and(
            eq(operations.digest, digest),
            isNull(operations.response),
            lte(operations.lease_until, now),
          ),
          target: operations.operation_key,
        })
        .returning({ response: operations.response });
      if (claimed)
        return {
          acquired: claimed.response === null || claimed.response === undefined,
        };
      const [existing] = await db
        .select({ digest: operations.digest, response: operations.response })
        .from(operations)
        .where(eq(operations.operation_key, key))
        .limit(1);
      if (existing?.digest !== undefined && existing.digest !== digest)
        throw new Error("Idempotency key reused with different input");
      return {
        acquired: false,
        ...(existing?.response === null || existing?.response === undefined
          ? {}
          : { response: existing.response }),
      };
    },
    complete: async (key, digest, response) =>
      (
        await db
          .update(operations)
          .set({ response: encodedJsonb(response) })
          .where(
            and(
              eq(operations.operation_key, key),
              eq(operations.digest, digest),
              isNull(operations.response),
            ),
          )
          .returning({ id: operations.operation_key })
      ).length === 1,
  };
};
const hash = async (value: unknown) =>
  [
    ...new Uint8Array(
      await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(JSON.stringify(value)),
      ),
    ),
  ]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
export const createAgentControlHandler =
  ({
    authorize,
    basePath = "/agent-control",
    control,
    operations,
    now = Date.now,
  }: {
    authorize: (
      request: Request,
    ) => Promise<Operator | undefined> | Operator | undefined;
    basePath?: string;
    control: AgentControlPlane;
    operations: OperationStore;
    now?: () => number;
  }) =>
  async (request: Request): Promise<Response | null> => {
    const url = new URL(request.url);
    if (!url.pathname.startsWith(`${basePath}/agents/`)) return null;
    const operator = await authorize(request);
    if (!operator) return new Response("Unauthorized", { status: 401 });
    const rest = url.pathname.slice(`${basePath}/agents/`.length).split("/");
    const agentId = decodeURIComponent(rest[0] ?? "");
    const action = rest[1];
    const required =
      request.method === "GET"
        ? "agents:read"
        : action === "restore"
          ? "agents:restore"
          : "agents:revoke";
    if (!operator.scopes.includes(required))
      return new Response("Forbidden", { status: 403 });
    if (request.method === "GET" && !action)
      return Response.json(await control.inventory(agentId));
    if (
      request.method !== "POST" ||
      (action !== "revoke" && action !== "restore")
    )
      return new Response(null, { status: 405 });
    if (
      request.headers.get("origin") !== url.origin ||
      request.headers.get("x-agent-control-intent") !== "mutate"
    )
      return new Response("Cross-site mutation denied", { status: 403 });
    const raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > 4_096)
      return Response.json(
        { error: "Request body is too large" },
        { status: 413 },
      );
    const body = (() => {
      try {
        return JSON.parse(raw);
      } catch {
        return undefined;
      }
    })() as { operationId?: string; reason?: string } | undefined;
    if (
      !body?.operationId ||
      body.operationId.length > 200 ||
      !body.reason ||
      body.reason.length > 1_000
    )
      return Response.json(
        { error: "A bounded operationId and reason are required" },
        { status: 400 },
      );
    const digest = await hash({ action, agentId, reason: body.reason });
    let claim;
    try {
      claim = await operations.claim(body.operationId, digest, now(), 30_000);
    } catch (error) {
      return Response.json(
        { error: error instanceof Error ? error.message : "conflict" },
        { status: 409 },
      );
    }
    if (claim.response !== undefined) return Response.json(claim.response);
    if (!claim.acquired)
      return Response.json(
        { error: "operation in progress" },
        { status: 409, headers: { "retry-after": "5" } },
      );
    const response =
      action === "revoke"
        ? await control.revoke({
            activatedBy: operator.id,
            agentId,
            reason: body.reason,
          })
        : (await control.restore(agentId),
          { agentId, restored: true, restoredBy: operator.id });
    if (!(await operations.complete(body.operationId, digest, response)))
      throw new Error("Control operation completion lost");
    return Response.json(response);
  };

export type ControlSqlResult<Row> = { rows: ReadonlyArray<Row> };
export type ControlSqlClient = {
  query: <Row = Record<string, unknown>>(
    text: string,
    values?: readonly unknown[],
  ) => Promise<ControlSqlResult<Row>>;
};
export const agentControlPostgresSchemaSql = (namespace = "agent_control") => {
  const ns = nsOf(namespace);
  return `CREATE SCHEMA IF NOT EXISTS ${ns}; CREATE TABLE IF NOT EXISTS ${ns}.operations (operation_key text PRIMARY KEY, digest text NOT NULL, lease_until bigint NOT NULL, response jsonb);`;
};
export const createPostgresOperationStore = ({
  client,
  namespace = "agent_control",
}: {
  client: ControlSqlClient;
  namespace?: string;
}): OperationStore => {
  const ns = nsOf(namespace);
  return {
    claim: async (key, digest, now, leaseMs) => {
      const result = await client.query<{ digest: string; response: unknown }>(
        `INSERT INTO ${ns}.operations (operation_key,digest,lease_until) VALUES ($1,$2,$3) ON CONFLICT (operation_key) DO UPDATE SET lease_until=$3 WHERE ${ns}.operations.digest=$2 AND ${ns}.operations.response IS NULL AND ${ns}.operations.lease_until <= $4 RETURNING digest,response`,
        [key, digest, now + leaseMs, now],
      );
      const row = result.rows[0];
      if (!row) {
        const existing = (
          await client.query<{ digest: string; response: unknown }>(
            `SELECT digest,response FROM ${ns}.operations WHERE operation_key=$1`,
            [key],
          )
        ).rows[0];
        if (existing?.digest !== undefined && existing.digest !== digest)
          throw new Error("Idempotency key reused with different input");
        return {
          acquired: false,
          ...(existing?.response === null || existing?.response === undefined
            ? {}
            : { response: existing.response }),
        };
      }
      return { acquired: row.response === null || row.response === undefined };
    },
    complete: async (key, digest, response) =>
      (
        await client.query(
          `UPDATE ${ns}.operations SET response=$3::jsonb WHERE operation_key=$1 AND digest=$2 AND response IS NULL RETURNING operation_key`,
          [key, digest, JSON.stringify(response)],
        )
      ).rows.length === 1,
  };
};
