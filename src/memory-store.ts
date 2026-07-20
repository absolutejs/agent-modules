import type {
  AgentMemoryScope,
  AgentMemoryStore,
  StoredAgentMemoryRecord,
} from "./types";
const scopeKey = (scope: AgentMemoryScope) =>
  JSON.stringify([
    scope.tenantId,
    scope.namespace,
    scope.userId ?? "",
    scope.agentId ?? "",
    scope.runId ?? "",
  ]);
export const createMemoryAgentMemoryStore = (): AgentMemoryStore => {
  const rows = new Map<string, StoredAgentMemoryRecord>();
  const requests = new Map<string, string>();
  const keyOf = (scope: AgentMemoryScope, key: string) =>
    `${scopeKey(scope)}:${key}`;
  return {
    put: async ({ record, requestId, expectedVersion }) => {
      const previousId = requests.get(requestId);
      if (previousId)
        return structuredClone(
          [...rows.values()].find((row) => row.id === previousId)!,
        );
      const key = keyOf(record.scope, record.key);
      const existing = rows.get(key);
      if (
        expectedVersion !== undefined &&
        existing?.version !== expectedVersion
      )
        throw new Error("Agent memory version conflict");
      if (existing && expectedVersion === undefined)
        throw new Error("expectedVersion is required to replace memory");
      rows.set(key, structuredClone(record));
      requests.set(requestId, record.id);
      return structuredClone(record);
    },
    get: async (scope, key) => structuredClone(rows.get(keyOf(scope, key))),
    getByIds: async (ids) =>
      [...rows.values()]
        .filter((row) => ids.includes(row.id))
        .map((row) => structuredClone(row)),
    list: async (scope, limit) =>
      [...rows.values()]
        .filter((row) => scopeKey(row.scope) === scopeKey(scope))
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .slice(0, limit)
        .map((row) => structuredClone(row)),
    listRecords: async ({ tenantId, limit }) =>
      [...rows.values()]
        .filter((row) => !tenantId || row.scope.tenantId === tenantId)
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
        .slice(0, Math.max(1, Math.min(limit, 200)))
        .map((row) => structuredClone(row)),
    delete: async (scope, key) => rows.delete(keyOf(scope, key)),
    eraseSubject: async ({ tenantId, userId }) => {
      const matched = [...rows].filter(
        ([, row]) =>
          row.scope.tenantId === tenantId &&
          (row.scope.userId === userId || row.createdBy.userId === userId),
      );
      for (const [key] of matched) rows.delete(key);
      return matched.length;
    },
    prune: async (now, limit) => {
      const matched = [...rows]
        .filter(([, row]) => row.expiresAt && row.expiresAt <= now)
        .slice(0, limit);
      for (const [key] of matched) rows.delete(key);
      return matched.length;
    },
  };
};
