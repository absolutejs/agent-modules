import { describe, expect, test } from "bun:test";
import {
  createAgentControlConsoleHandler,
  createMemoryOperationStore,
  type AgentControlSnapshot,
} from "../src";

const snapshot: AgentControlSnapshot = {
  agents: [
    { id: "agent-1", status: "active", secret: "must-not-leak" } as never,
  ],
  approvals: [
    {
      action: "wallet.transfer",
      agentId: "agent-1",
      id: "approval-1",
      requestedAt: "2026-07-16T00:00:00.000Z",
      summary: "Transfer $5",
    },
  ],
  delegations: [],
  memories: [],
  reputations: [],
  runs: [],
};

describe("agent control console", () => {
  test("serves a CSP-hardened authenticated console and safe snapshot", async () => {
    const handler = createAgentControlConsoleHandler({
      authorize: () => ({ id: "operator", scopes: ["agents:read"] }),
      data: {
        decideApproval: async () => ({}),
        snapshot: async () => snapshot,
      },
      operations: createMemoryOperationStore(),
    });
    const response = await handler(
      new Request("https://example.test/agent-control"),
    );
    expect(response?.headers.get("content-security-policy")).toContain(
      "frame-ancestors 'none'",
    );
    expect(response?.headers.get("cache-control")).toBe("no-store");
    expect(await response?.text()).toContain("AbsoluteJS Agent Control");
    const api = await handler(
      new Request("https://example.test/agent-control/api/snapshot"),
    );
    const safe = (await api?.json()) as AgentControlSnapshot;
    expect(safe.agents[0]).toEqual({ id: "agent-1", status: "active" });
    expect(JSON.stringify(safe)).not.toContain("must-not-leak");
  });

  test("requires scope and same-origin intent for approval decisions", async () => {
    let decisions = 0;
    const make = (scopes: string[]) =>
      createAgentControlConsoleHandler({
        authorize: () => ({ id: "operator", scopes }),
        data: {
          decideApproval: async (input) => {
            decisions += 1;
            return input;
          },
          snapshot: async () => snapshot,
        },
        operations: createMemoryOperationStore(),
      });
    const request = (headers: HeadersInit) =>
      new Request(
        "https://example.test/agent-control/api/approvals/approval-1/approve",
        {
          body: JSON.stringify({ reason: "reviewed" }),
          headers: { "content-type": "application/json", ...headers },
          method: "POST",
        },
      );
    expect((await make(["agents:read"])(request({})))?.status).toBe(403);
    const handler = make(["agents:read", "agents:approve"]);
    expect((await handler(request({ "idempotency-key": "one" })))?.status).toBe(
      403,
    );
    const headers = {
      "idempotency-key": "one",
      origin: "https://example.test",
      "x-agent-control-intent": "mutate",
    };
    expect((await handler(request(headers)))?.status).toBe(200);
    expect((await handler(request(headers)))?.status).toBe(200);
    expect(decisions).toBe(1);
  });
});
