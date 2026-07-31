import type { AgentSandboxOperationStore, AgentSandboxResult } from "./types";

export const createMemoryAgentSandboxOperationStore =
  (): AgentSandboxOperationStore => {
    const operations = new Map<
      string,
      | { state: "in_progress" }
      | { state: "completed"; result: AgentSandboxResult }
    >();
    const uses = new Map<string, number>();
    return {
      begin: async ({ grantId, capabilityId, requestId, maxUses }) => {
        const key = `${grantId}:${requestId}`;
        const existing = operations.get(key);
        if (existing?.state === "completed")
          return {
            state: "completed",
            result: structuredClone(existing.result),
          };
        if (existing) return { state: "in_progress" };
        const usageKey = `${grantId}:${capabilityId}`;
        const used = uses.get(usageKey) ?? 0;
        if (maxUses !== undefined && used >= maxUses)
          return { state: "limit_exceeded" };
        uses.set(usageKey, used + 1);
        operations.set(key, { state: "in_progress" });
        return { state: "acquired" };
      },
      complete: async ({ grantId, requestId, result }) => {
        const key = `${grantId}:${requestId}`;
        if (operations.get(key)?.state !== "in_progress") return false;
        operations.set(key, {
          state: "completed",
          result: structuredClone(result),
        });
        return true;
      },
      // Ambiguous failures stay locked. The adapter may have completed its
      // external effect before the local error, so automatic replay is unsafe.
      fail: async () => {},
    };
  };
