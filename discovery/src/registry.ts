import type {
  AgentDiscoveryDocument,
  AgentRecord,
  AgentRegistryStore,
  AgentSearchQuery,
  AgentSearchResult,
  DiscoveryVerifier,
  SignedAgentDiscoveryDocument,
} from "./types";
import { verifyAgentDocument } from "./signatures";

const normalized = (value: string) =>
  value.toLocaleLowerCase().normalize("NFKC");
const tokens = (value: string) =>
  normalized(value)
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
const includesEvery = (
  haystack: readonly string[] | undefined,
  needles: readonly string[] | undefined,
) =>
  !needles?.length ||
  needles.every((needle) =>
    haystack?.some((candidate) => normalized(candidate) === normalized(needle)),
  );

const searchable = (agent: AgentDiscoveryDocument) =>
  [
    agent.name,
    agent.description,
    ...(agent.tags ?? []),
    ...(agent.categories ?? []),
    ...agent.capabilities.flatMap((capability) => [
      capability.id,
      capability.title,
      capability.description,
      ...(capability.tags ?? []),
    ]),
  ].join(" ");

export const matchesAgent = (record: AgentRecord, query: AgentSearchQuery) => {
  const agent = record.signed.document;
  if (query.verifiedOnly && !record.verified) return false;
  if (!includesEvery(agent.tags, query.tags)) return false;
  if (!includesEvery(agent.categories, query.categories)) return false;
  if (!includesEvery(agent.languages, query.languages)) return false;
  if (!includesEvery(agent.paymentProtocols, query.paymentProtocols))
    return false;
  if (
    query.interfaces?.length &&
    !query.interfaces.every((type) =>
      agent.interfaces.some((entry) => entry.type === type),
    )
  )
    return false;
  if (query.capability) {
    const wanted = normalized(query.capability);
    if (
      !agent.capabilities.some((capability) =>
        normalized(
          `${capability.id} ${capability.title} ${capability.description}`,
        ).includes(wanted),
      )
    )
      return false;
  }
  const wantedTokens = tokens(query.text ?? "");
  const candidate = normalized(searchable(agent));
  return wantedTokens.every((token) => candidate.includes(token));
};

export const scoreAgent = (
  record: AgentRecord,
  query: AgentSearchQuery,
): AgentSearchResult => {
  const agent = record.signed.document;
  const wanted = tokens(query.text ?? "");
  const name = normalized(agent.name);
  const id = normalized(agent.id);
  const matched: string[] = [];
  let score = record.verified ? 20 : 0;
  for (const token of wanted) {
    if (name === token) {
      score += 100;
      matched.push("exact-name");
    } else if (name.includes(token)) {
      score += 30;
      matched.push("name");
    }
    if (id.includes(token)) {
      score += 20;
      matched.push("id");
    }
    if (agent.tags?.some((tag) => normalized(tag) === token)) {
      score += 16;
      matched.push("tag");
    }
    if (
      agent.capabilities.some((capability) =>
        normalized(`${capability.id} ${capability.title}`).includes(token),
      )
    ) {
      score += 14;
      matched.push("capability");
    }
    if (normalized(agent.description).includes(token)) {
      score += 4;
      matched.push("description");
    }
  }
  return {
    agent,
    verified: record.verified,
    score,
    matched: [...new Set(matched)],
  };
};

export const createMemoryAgentRegistry = (): AgentRegistryStore => {
  const records = new Map<string, AgentRecord>();
  return {
    get: async (id) => records.get(id),
    upsert: async (record) => {
      records.set(record.signed.document.id, structuredClone(record));
    },
    remove: async (id) => records.delete(id),
    list: async (query) =>
      [...records.values()].filter((record) => matchesAgent(record, query)),
  };
};

export const createAgentRegistry = ({
  store,
  verifier,
  requireVerified = true,
}: {
  store: AgentRegistryStore;
  verifier?: DiscoveryVerifier;
  requireVerified?: boolean;
}) => ({
  publish: async (signed: SignedAgentDiscoveryDocument) => {
    const verification = verifier
      ? await verifyAgentDocument(signed, verifier)
      : { ok: false, validKeyIds: [], errors: ["no verifier configured"] };
    if (requireVerified && !verification.ok)
      throw new Error(
        `Agent discovery verification failed: ${verification.errors.join(", ")}`,
      );
    const now = new Date().toISOString();
    const existing = await store.get(signed.document.id);
    await store.upsert({
      signed,
      verified: verification.ok,
      firstSeenAt: existing?.firstSeenAt ?? now,
      lastSeenAt: now,
    });
    return verification;
  },
  get: (id: string) => store.get(id),
  remove: (id: string) => store.remove(id),
  search: async (
    query: AgentSearchQuery,
  ): Promise<{
    results: readonly AgentSearchResult[];
    nextCursor?: string;
  }> => {
    const limit = Math.max(1, Math.min(query.limit ?? 20, 100));
    const offset = query.cursor
      ? Number.parseInt(Buffer.from(query.cursor, "base64url").toString(), 10)
      : 0;
    const records = await store.list({
      ...query,
      limit: Math.min(100, limit + offset + 1),
    });
    const ranked = records
      .map((record) => scoreAgent(record, query))
      .sort(
        (left, right) =>
          right.score - left.score ||
          left.agent.id.localeCompare(right.agent.id),
      );
    const page = ranked.slice(offset, offset + limit);
    const next =
      ranked.length > offset + limit
        ? Buffer.from(String(offset + limit)).toString("base64url")
        : undefined;
    return { results: page, ...(next ? { nextCursor: next } : {}) };
  },
});
