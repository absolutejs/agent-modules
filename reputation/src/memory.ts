import type {
  AgentReputationStore,
  StoredAgentReputationEvidence,
} from "./types";

const clone = <Value>(value: Value): Value => structuredClone(value);

export const createMemoryAgentReputationStore = (): AgentReputationStore => {
  const evidence = new Map<string, StoredAgentReputationEvidence>();
  return {
    get: async (id) => {
      const found = evidence.get(id);
      return found ? clone(found) : undefined;
    },
    list: async (subject, scope) =>
      [...evidence.values()]
        .filter((item) => item.subject === subject && item.scope === scope)
        .sort((left, right) => left.issuedAt.localeCompare(right.issuedAt))
        .map(clone),
    put: async (item) => {
      if (evidence.has(item.evidenceId))
        throw new Error("Agent reputation evidence already exists");
      evidence.set(item.evidenceId, clone(item));
    },
    revoke: async (id, revokedAt) => {
      const found = evidence.get(id);
      if (!found || found.revokedAt) return false;
      found.revokedAt = revokedAt;
      return true;
    },
  };
};
