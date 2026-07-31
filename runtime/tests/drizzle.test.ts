import { expect, test } from "bun:test";
import { SQL } from "bun";
import { sql as expression } from "drizzle-orm";
import { drizzle } from "drizzle-orm/bun-sql";
import { createDrizzleAgentRuntimeStore } from "../src";

const databaseUrl = process.env.DATABASE_URL;

test.skipIf(!databaseUrl)(
  "Drizzle runtime preserves JSON paths and lifecycle",
  async () => {
    const client = new SQL(databaseUrl!);
    const db = drizzle({ client });
    const rollback = new Error("expected rollback");
    try {
      await db.transaction(async (transaction) => {
        const suffix = crypto.randomUUID();
        const now = new Date().toISOString();
        const store = createDrizzleAgentRuntimeStore(transaction);
        const run = {
          actor: {
            agentId: "agent",
            tenantId: `tenant-${suffix}`,
            userId: "user",
          },
          agent: {
            descriptorDigest: "sha256:test",
            descriptorId: "agent:test",
            descriptorVersion: "1.0.0",
          },
          budget: {},
          createdAt: now,
          goal: "Drizzle conformance",
          id: `run-${suffix}`,
          input: { portable: true },
          status: "queued" as const,
          updatedAt: now,
          usage: {
            actions: 0,
            costMicros: 0,
            inputTokens: 0,
            outputTokens: 0,
            spendMinor: 0,
            wallTimeMs: 0,
          },
          version: 1,
        };
        await store.createRun(run);
        const [shape] = await transaction.execute(
          expression<{
            kind: string;
          }>`select jsonb_typeof(document) as kind from agent_runtime.runs where id = ${run.id}`,
        );
        expect(shape?.kind).toBe("object");
        expect(
          await store.listRuns({ tenantId: run.actor.tenantId }),
        ).toHaveLength(1);
        expect(
          (await store.requestCancel({ runId: run.id, now }))?.status,
        ).toBe("cancelled");
        throw rollback;
      });
    } catch (error) {
      if (error !== rollback) throw error;
    } finally {
      await client.close();
    }
  },
);
