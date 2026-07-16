import { describe, expect, test } from "bun:test";
import { createAgentMemory, createMemoryAgentMemoryStore } from "../src";
const actor = { tenantId: "tenant", userId: "user", agentId: "agent" };
const scope = {
  tenantId: "tenant",
  userId: "user",
  agentId: "agent",
  namespace: "preferences",
};
const provenance = {
  source: "user://user",
  sourceType: "user" as const,
  retrievedAt: "2026-07-15T00:00:00Z",
  digest: "sha256:abc",
  taints: ["user-controlled"],
};
describe("agent memory", () => {
  test("scopes, encrypts, expires, authorizes, and erases provenance-bearing memory", async () => {
    let clock = Date.parse("2026-07-15T00:00:00Z");
    const memory = createAgentMemory({
      store: createMemoryAgentMemoryStore(),
      authorize: ({ actor, scope }) => actor.tenantId === scope.tenantId,
      codec: {
        encode: async (value) => ({ ciphertext: btoa(JSON.stringify(value)) }),
        decode: async (value) => JSON.parse(atob((value as any).ciphertext)),
      },
      now: () => clock,
      id: () => "memory-1",
    });
    const saved = await memory.put({
      actor,
      scope,
      key: "theme",
      value: "dark",
      provenance,
      expiresAt: "2026-07-16T00:00:00Z",
      requestId: "request-1",
    });
    expect(saved.provenance.taints).toEqual(["user-controlled"]);
    expect((await memory.get(actor, scope, "theme"))?.value).toBe("dark");
    await expect(
      memory.get({ ...actor, tenantId: "other" }, scope, "theme"),
    ).rejects.toThrow("Cross-tenant");
    clock = Date.parse("2026-07-17T00:00:00Z");
    expect(await memory.get(actor, scope, "theme")).toBeUndefined();
    expect(await memory.prune()).toBe(1);
  });
});
