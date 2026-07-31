import { describe, expect, test } from "bun:test";
import {
  createAgentPlaygroundHandler,
  createMemoryAgentPlaygroundPlanStore,
  createMemoryOperationStore,
} from "../src";

describe("agent playground", () => {
  test("binds a simulated plan and executes it idempotently", async () => {
    let executions = 0;
    const handler = createAgentPlaygroundHandler({
      adapter: {
        catalog: () => [
          {
            id: "calendar",
            name: "Calendar",
            operations: ["calendar.create"],
            protocols: ["a2a-1.0"],
          },
        ],
        execute: async (plan) => {
          executions += 1;
          return { input: plan.input, ok: true };
        },
        plan: () => ({
          effects: ["write"],
          status: "ready",
          steps: [{ description: "Create event", protocol: "a2a-1.0" }],
          summary: "Create one calendar event",
        }),
      },
      authorize: () => ({
        id: "operator",
        scopes: ["agents:read", "agents:simulate", "agents:execute"],
      }),
      operations: createMemoryOperationStore(),
      plans: createMemoryAgentPlaygroundPlanStore(),
    });
    const mutationHeaders = {
      "content-type": "application/json",
      origin: "https://example.test",
      "x-agent-control-intent": "mutate",
    };
    const planned = await handler(
      new Request("https://example.test/agent-playground/api/plans", {
        body: JSON.stringify({
          agentId: "calendar",
          input: { title: "Launch" },
          operation: "calendar.create",
        }),
        headers: mutationHeaders,
        method: "POST",
      }),
    );
    expect(planned?.status).toBe(201);
    const visible = (await planned?.json()) as {
      input?: unknown;
      inputDigest: string;
      planId: string;
    };
    expect(visible.input).toBeUndefined();
    expect(visible.inputDigest).toBeString();
    const execute = () =>
      handler(
        new Request(
          `https://example.test/agent-playground/api/plans/${visible.planId}/execute`,
          {
            body: "{}",
            headers: { ...mutationHeaders, "idempotency-key": "execute-once" },
            method: "POST",
          },
        ),
      );
    expect(await (await execute())?.json()).toEqual({
      input: { title: "Launch" },
      ok: true,
    });
    expect(await (await execute())?.json()).toEqual({
      input: { title: "Launch" },
      ok: true,
    });
    expect(executions).toBe(1);
  });

  test("refuses cross-site planning and non-ready execution", async () => {
    const handler = createAgentPlaygroundHandler({
      adapter: {
        catalog: () => [],
        execute: async () => ({ shouldNot: "run" }),
        plan: () => ({
          effects: ["transfer"],
          status: "approval-required",
          steps: [{ description: "Transfer funds" }],
          summary: "Transfer funds",
        }),
      },
      authorize: () => ({
        id: "operator",
        scopes: ["agents:read", "agents:simulate", "agents:execute"],
      }),
      operations: createMemoryOperationStore(),
      plans: createMemoryAgentPlaygroundPlanStore(),
    });
    const denied = await handler(
      new Request("https://example.test/agent-playground/api/plans", {
        body: "{}",
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
    );
    expect(denied?.status).toBe(403);
  });
});
