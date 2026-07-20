import { describe, expect, test } from "bun:test";
import {
  AgentEffectDeferredError,
  createAgentRuntime,
  createAgentRuntimeWorker,
  createMemoryAgentRuntimeStore,
  type AgentTransition,
} from "../src";

const actor = { tenantId: "tenant-1", userId: "user-1", agentId: "agent-1" };
const agent = {
  descriptorId: "https://agent.example/.well-known/absolute-agent.json",
  descriptorVersion: "1.0.0",
  descriptorDigest: "sha256:abc",
};

describe("agent runtime", () => {
  test("lists runs within an actor scope", async () => {
    const store = createMemoryAgentRuntimeStore();
    const runtime = createAgentRuntime({
      store,
      driver: { next: async () => ({ type: "complete", output: null }) },
      effects: { execute: async () => undefined },
    });
    await runtime.start({ actor, agent, goal: "Owned", input: {} });
    await runtime.start({
      actor: { ...actor, tenantId: "tenant-2" },
      agent,
      goal: "Other tenant",
      input: {},
    });
    expect(await runtime.list({ tenantId: actor.tenantId })).toHaveLength(1);
    expect((await runtime.list({ tenantId: actor.tenantId }))[0]?.goal).toBe(
      "Owned",
    );
  });

  test("runs an idempotent effect and completes with discovery identity pinned", async () => {
    const store = createMemoryAgentRuntimeStore();
    const transitions: AgentTransition[] = [
      {
        type: "effect",
        name: "email.send",
        input: { to: "user@example.com" },
        idempotencyKey: "welcome",
        usage: { costMicros: 50 },
      },
      { type: "complete", output: { ok: true } },
    ];
    const executed: string[] = [];
    const runtime = createAgentRuntime({
      store,
      driver: {
        next: async () =>
          transitions.shift() ?? {
            type: "fail",
            code: "empty",
            message: "empty",
          },
      },
      effects: {
        execute: async ({ idempotencyKey }) => {
          executed.push(idempotencyKey);
          return { delivered: true };
        },
      },
    });
    const started = await runtime.start({
      actor,
      agent,
      goal: "Welcome the user",
      input: {},
      budget: { actions: 1, costMicros: 100 },
    });
    const finished = await runtime.workOne("worker-1");
    expect(finished?.status).toBe("completed");
    expect(finished?.agent).toEqual(agent);
    expect(finished?.usage.actions).toBe(1);
    expect(executed).toEqual(["welcome"]);
    expect(
      (await runtime.inspect(started.id))?.steps.map(({ kind }) => kind),
    ).toEqual(["effect.requested", "effect.completed", "completed"]);
  });

  test("fails closed before an over-budget effect executes", async () => {
    const store = createMemoryAgentRuntimeStore();
    let executed = false;
    const runtime = createAgentRuntime({
      store,
      driver: {
        next: async () => ({
          type: "effect",
          name: "wallet.pay",
          input: {},
          idempotencyKey: "pay",
          usage: { spendMinor: 101 },
        }),
      },
      effects: {
        execute: async () => {
          executed = true;
        },
      },
    });
    await runtime.start({
      actor,
      agent,
      goal: "Pay",
      input: {},
      budget: { spendMinor: 100 },
    });
    expect((await runtime.workOne("worker-1"))?.error?.code).toBe(
      "budget_exceeded",
    );
    expect(executed).toBe(false);
  });

  test("persists waits and resumes only when due", async () => {
    let clock = Date.parse("2026-07-15T00:00:00.000Z");
    const store = createMemoryAgentRuntimeStore();
    const transitions: AgentTransition[] = [
      { type: "wait", until: "2026-07-15T00:01:00.000Z", reason: "rate limit" },
      { type: "complete", output: "done" },
    ];
    const runtime = createAgentRuntime({
      store,
      now: () => clock,
      driver: { next: async () => transitions.shift()! },
      effects: { execute: async () => undefined },
    });
    await runtime.start({ actor, agent, goal: "Wait", input: {} });
    expect((await runtime.workOne("worker-1"))?.status).toBe("waiting");
    expect(await runtime.workOne("worker-1")).toBeUndefined();
    clock += 60_001;
    expect((await runtime.workOne("worker-1"))?.status).toBe("completed");
  });

  test("observes cancellation before asking the driver for another action", async () => {
    const store = createMemoryAgentRuntimeStore();
    let calls = 0;
    const runtime = createAgentRuntime({
      store,
      driver: {
        next: async () => {
          calls += 1;
          return { type: "checkpoint", checkpoint: {} };
        },
      },
      effects: { execute: async () => undefined },
    });
    const run = await runtime.start({ actor, agent, goal: "Stop", input: {} });
    expect((await runtime.cancel(run.id))?.status).toBe("cancelled");
    expect(await runtime.workOne("worker-1")).toBeUndefined();
    expect(calls).toBe(0);
  });

  test("recovers a persisted effect request after a worker crash", async () => {
    const store = createMemoryAgentRuntimeStore();
    const startedAt = "2026-07-15T00:00:00.000Z";
    const runtime = createAgentRuntime({
      store,
      now: () => Date.parse("2026-07-15T00:01:00.000Z"),
      driver: { next: async () => ({ type: "complete", output: "recovered" }) },
      effects: {
        execute: async ({ idempotencyKey }) => ({ recovered: idempotencyKey }),
      },
    });
    const run = await runtime.start({
      actor,
      agent,
      goal: "Recover",
      input: {},
    });
    const claimed = await store.claimDue({
      workerId: "crashed-worker",
      now: startedAt,
      leaseExpiresAt: "2026-07-15T00:00:30.000Z",
    });
    expect(claimed).toBeDefined();
    await store.appendStep({
      runId: run.id,
      workerId: "crashed-worker",
      expectedVersion: claimed!.version,
      now: startedAt,
      step: {
        id: "request-1",
        runId: run.id,
        sequence: 1,
        kind: "effect.requested",
        name: "email.send",
        input: { to: "user@example.com" },
        idempotencyKey: "welcome",
        usage: {
          actions: 1,
          costMicros: 0,
          inputTokens: 0,
          outputTokens: 0,
          spendMinor: 0,
          wallTimeMs: 0,
        },
        createdAt: startedAt,
      },
    });
    expect((await runtime.workOne("recovery-worker"))?.status).toBe(
      "completed",
    );
    expect(
      (await runtime.inspect(run.id))?.steps.map(({ kind }) => kind),
    ).toEqual(["effect.requested", "effect.completed", "completed"]);
  });

  test("waits for a durable effect and resumes its original request", async () => {
    let clock = Date.parse("2026-07-15T00:00:00.000Z");
    let effectCalls = 0;
    const store = createMemoryAgentRuntimeStore();
    const runtime = createAgentRuntime({
      store,
      now: () => clock,
      driver: {
        next: async ({ steps }) =>
          steps.some(({ kind }) => kind === "effect.completed")
            ? { type: "complete", output: "done" }
            : {
                type: "effect",
                name: "email.send",
                input: { to: "user@example.com" },
                idempotencyKey: "welcome",
              },
      },
      effects: {
        execute: async () => {
          effectCalls += 1;
          if (effectCalls === 1)
            throw new AgentEffectDeferredError("2026-07-15T00:00:10.000Z");
          return { delivered: true };
        },
      },
    });
    const started = await runtime.start({
      actor,
      agent,
      goal: "Welcome",
      input: {},
    });
    expect((await runtime.workOne("worker-1"))?.status).toBe("waiting");
    clock += 10_001;
    expect((await runtime.workOne("worker-2"))?.status).toBe("completed");
    expect(
      (await runtime.inspect(started.id))?.steps.map(({ kind }) => kind),
    ).toEqual(["effect.requested", "effect.completed", "completed"]);
  });

  test("runs through an observable drainable worker", async () => {
    const runtime = createAgentRuntime({
      driver: { next: async () => ({ output: "done", type: "complete" }) },
      effects: { execute: async () => undefined },
      store: createMemoryAgentRuntimeStore(),
    });
    await runtime.start({ actor, agent, goal: "Work", input: {} });
    const worker = createAgentRuntimeWorker({ runtime, workerId: "worker-1" });
    expect((await worker.runOnce())?.status).toBe("completed");
    expect(worker.metrics()).toMatchObject({
      claimed: 1,
      completed: 1,
      failed: 0,
      polls: 1,
    });
    worker.drain();
    expect(await worker.runOnce()).toBeUndefined();
    await worker.stop();
  });
});
