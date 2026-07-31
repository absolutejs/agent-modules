export type AgentMemoryScope = {
  tenantId: string;
  namespace: string;
  userId?: string;
  agentId?: string;
  runId?: string;
};
export type AgentMemoryActor = {
  tenantId: string;
  userId: string;
  agentId: string;
  delegationId?: string;
};
export type AgentMemoryProvenance = {
  source: string;
  sourceType: "user" | "agent" | "tool" | "web" | "file" | "memory" | "system";
  retrievedAt: string;
  digest: string;
  parentDigests?: string[];
  proof?: unknown;
  taints?: string[];
};
export type AgentMemoryRecord<Value = unknown> = {
  id: string;
  key: string;
  scope: AgentMemoryScope;
  value: Value;
  provenance: AgentMemoryProvenance;
  sensitivity: "public" | "internal" | "personal" | "secret";
  version: number;
  createdAt: string;
  updatedAt: string;
  expiresAt?: string;
  createdBy: AgentMemoryActor;
};
export type StoredAgentMemoryRecord = Omit<AgentMemoryRecord, "value"> & {
  encodedValue: unknown;
};
export type AgentMemoryOperation =
  | "read"
  | "write"
  | "search"
  | "delete"
  | "erase";
export type AgentMemoryAuthorizer = (input: {
  operation: AgentMemoryOperation;
  actor: AgentMemoryActor;
  scope: AgentMemoryScope;
  record?: AgentMemoryRecord;
}) => boolean | Promise<boolean>;
export type AgentMemoryCodec = {
  encode(
    value: unknown,
    context: { scope: AgentMemoryScope; key: string },
  ): Promise<unknown>;
  decode(
    value: unknown,
    context: { scope: AgentMemoryScope; key: string },
  ): Promise<unknown>;
};
export type AgentMemoryStore = {
  put(input: {
    record: StoredAgentMemoryRecord;
    requestId: string;
    expectedVersion?: number;
  }): Promise<StoredAgentMemoryRecord>;
  get(
    scope: AgentMemoryScope,
    key: string,
  ): Promise<StoredAgentMemoryRecord | undefined>;
  getByIds(ids: readonly string[]): Promise<StoredAgentMemoryRecord[]>;
  list(
    scope: AgentMemoryScope,
    limit: number,
  ): Promise<StoredAgentMemoryRecord[]>;
  listRecords(input: {
    tenantId?: string;
    limit: number;
  }): Promise<StoredAgentMemoryRecord[]>;
  delete(scope: AgentMemoryScope, key: string): Promise<boolean>;
  eraseSubject(input: { tenantId: string; userId: string }): Promise<number>;
  prune(now: string, limit: number): Promise<number>;
};
export type AgentMemorySearchIndex = {
  upsert(record: AgentMemoryRecord): Promise<void>;
  remove(id: string): Promise<void>;
  search(input: {
    scope: AgentMemoryScope;
    query: string;
    limit: number;
  }): Promise<Array<{ id: string; score: number }>>;
  eraseSubject?(input: { tenantId: string; userId: string }): Promise<void>;
};
