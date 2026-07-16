import type {
  AgentMemoryActor,
  AgentMemoryAuthorizer,
  AgentMemoryCodec,
  AgentMemoryProvenance,
  AgentMemoryRecord,
  AgentMemoryScope,
  AgentMemorySearchIndex,
  AgentMemoryStore,
  StoredAgentMemoryRecord,
} from "./types";
const identityCodec: AgentMemoryCodec = {
  encode: async (value) => structuredClone(value),
  decode: async (value) => structuredClone(value),
};
const assertScope = (actor: AgentMemoryActor, scope: AgentMemoryScope) => {
  if (actor.tenantId !== scope.tenantId)
    throw new Error("Cross-tenant agent memory access denied");
};
export const createAgentMemory = ({
  store,
  authorize,
  codec = identityCodec,
  index,
  validateWrite,
  now = Date.now,
  id = () => crypto.randomUUID(),
}: {
  store: AgentMemoryStore;
  authorize: AgentMemoryAuthorizer;
  codec?: AgentMemoryCodec;
  index?: AgentMemorySearchIndex;
  validateWrite?: (record: AgentMemoryRecord) => boolean | Promise<boolean>;
  now?: () => number;
  id?: () => string;
}) => {
  const decode = async (
    stored: StoredAgentMemoryRecord,
  ): Promise<AgentMemoryRecord> => ({
    ...stored,
    value: await codec.decode(stored.encodedValue, {
      scope: stored.scope,
      key: stored.key,
    }),
  });
  const permitted = async (
    operation: Parameters<AgentMemoryAuthorizer>[0]["operation"],
    actor: AgentMemoryActor,
    scope: AgentMemoryScope,
    record?: AgentMemoryRecord,
  ) => {
    assertScope(actor, scope);
    if (
      !(await authorize({
        operation,
        actor,
        scope,
        ...(record ? { record } : {}),
      }))
    )
      throw new Error(`Agent memory ${operation} denied`);
  };
  return {
    put: async (input: {
      actor: AgentMemoryActor;
      scope: AgentMemoryScope;
      key: string;
      value: unknown;
      provenance: AgentMemoryProvenance;
      sensitivity?: AgentMemoryRecord["sensitivity"];
      expiresAt?: string;
      requestId: string;
      expectedVersion?: number;
    }) => {
      await permitted("write", input.actor, input.scope);
      if (!input.provenance.digest)
        throw new Error("Memory provenance digest is required");
      if (input.expiresAt && !Number.isFinite(Date.parse(input.expiresAt)))
        throw new Error("Invalid memory expiration");
      const existing = await store.get(input.scope, input.key);
      const timestamp = new Date(now()).toISOString();
      const record: AgentMemoryRecord = {
        id: existing?.id ?? id(),
        key: input.key,
        scope: structuredClone(input.scope),
        value: structuredClone(input.value),
        provenance: structuredClone(input.provenance),
        sensitivity: input.sensitivity ?? "internal",
        version: (existing?.version ?? 0) + 1,
        createdAt: existing?.createdAt ?? timestamp,
        updatedAt: timestamp,
        ...(input.expiresAt ? { expiresAt: input.expiresAt } : {}),
        createdBy: structuredClone(input.actor),
      };
      if (validateWrite && !(await validateWrite(record)))
        throw new Error("Agent memory write failed trust validation");
      const stored: StoredAgentMemoryRecord = {
        ...record,
        encodedValue: await codec.encode(record.value, {
          scope: record.scope,
          key: record.key,
        }),
      };
      delete (stored as Partial<AgentMemoryRecord>).value;
      const saved = await store.put({
        record: stored,
        requestId: input.requestId,
        ...(input.expectedVersion !== undefined
          ? { expectedVersion: input.expectedVersion }
          : {}),
      });
      const decoded = await decode(saved);
      await index?.upsert(decoded);
      return decoded;
    },
    get: async (
      actor: AgentMemoryActor,
      scope: AgentMemoryScope,
      key: string,
    ) => {
      await permitted("read", actor, scope);
      const stored = await store.get(scope, key);
      if (
        !stored ||
        (stored.expiresAt && stored.expiresAt <= new Date(now()).toISOString())
      )
        return undefined;
      const record = await decode(stored);
      await permitted("read", actor, scope, record);
      return record;
    },
    search: async (
      actor: AgentMemoryActor,
      scope: AgentMemoryScope,
      query: string,
      limit = 10,
    ) => {
      await permitted("search", actor, scope);
      const ranked = index
        ? await index.search({ scope, query, limit })
        : (await store.list(scope, Math.min(limit, 100))).map(
            (row, position) => ({ id: row.id, score: 1 / (position + 1) }),
          );
      const rows = await store.getByIds(ranked.map((item) => item.id));
      const byId = new Map(rows.map((row) => [row.id, row]));
      const output: Array<{ record: AgentMemoryRecord; score: number }> = [];
      for (const item of ranked) {
        const row = byId.get(item.id);
        if (
          !row ||
          (row.expiresAt && row.expiresAt <= new Date(now()).toISOString())
        )
          continue;
        const record = await decode(row);
        await permitted("read", actor, scope, record);
        output.push({ record, score: item.score });
      }
      return output;
    },
    delete: async (
      actor: AgentMemoryActor,
      scope: AgentMemoryScope,
      key: string,
    ) => {
      await permitted("delete", actor, scope);
      const row = await store.get(scope, key);
      const removed = await store.delete(scope, key);
      if (removed && row) await index?.remove(row.id);
      return removed;
    },
    eraseSubject: async (actor: AgentMemoryActor, userId: string) => {
      const scope = { tenantId: actor.tenantId, namespace: "*", userId };
      await permitted("erase", actor, scope);
      const count = await store.eraseSubject({
        tenantId: actor.tenantId,
        userId,
      });
      await index?.eraseSubject?.({ tenantId: actor.tenantId, userId });
      return count;
    },
    prune: (limit = 1000) => store.prune(new Date(now()).toISOString(), limit),
  };
};
