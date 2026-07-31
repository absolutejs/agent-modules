export const ABSOLUTE_AGENT_SCHEMA =
  "https://absolutejs.github.io/agents/schemas/agent-discovery/v1.json" as const;
export const ABSOLUTE_AGENT_SCHEMA_LEGACY =
  "https://absolutejs.com/schemas/agent-discovery/v1" as const;
export const ABSOLUTE_AGENT_PATH = "/.well-known/absolute-agent.json" as const;
export const ABSOLUTE_AGENTS_PATH =
  "/.well-known/absolute-agents.json" as const;
export const A2A_AGENT_CARD_PATH = "/.well-known/agent-card.json" as const;
export const AGENTS_TEXT_PATH = "/agents.txt" as const;
export const AGENT_SITEMAP_PATH = "/agents-sitemap.xml" as const;
export const AGENT_REGISTRY_PATH =
  "/.well-known/absolute-agent-registry.json" as const;
export const AGENT_SEARCH_PATH = "/v1/agents" as const;

export type AgentEffect =
  | "read"
  | "write"
  | "delete"
  | "external"
  | "financial"
  | "communication"
  | "code-execution";

export type AgentCapability = {
  id: string;
  title: string;
  description: string;
  tags?: readonly string[];
  inputSchema?: Readonly<Record<string, unknown>>;
  outputSchema?: Readonly<Record<string, unknown>>;
  effects?: readonly AgentEffect[];
  scopes?: readonly string[];
  approval?: "never" | "policy" | "always";
  price?: { currency: string; amount: string; unit?: string };
};

export type AgentInterface = {
  type: "a2a" | "arazzo" | "mcp" | "http" | "openapi" | "webmcp" | "websocket";
  url: string;
  protocolVersion?: string;
  contentTypes?: readonly string[];
};

export type AgentAuthentication = {
  protectedResourceMetadata?: string;
  authorizationServers?: readonly string[];
  scopes?: readonly string[];
  schemes?: readonly ("oauth2" | "oidc" | "api-key" | "mtls" | "none")[];
  dpopBoundTokens?: boolean;
};

export type AgentPublisher = {
  id: string;
  name: string;
  url?: string;
  jwksUri?: string;
  contact?: string;
};

export type AgentDiscoveryDocument = {
  $schema: typeof ABSOLUTE_AGENT_SCHEMA | typeof ABSOLUTE_AGENT_SCHEMA_LEGACY;
  id: string;
  name: string;
  description: string;
  version: string;
  url: string;
  publisher: AgentPublisher;
  capabilities: readonly AgentCapability[];
  interfaces: readonly AgentInterface[];
  authentication?: AgentAuthentication;
  categories?: readonly string[];
  tags?: readonly string[];
  languages?: readonly string[];
  regions?: readonly string[];
  statusUrl?: string;
  privacyUrl?: string;
  termsUrl?: string;
  iconUrl?: string;
  documentationUrl?: string;
  paymentProtocols?: readonly string[];
  examples?: readonly {
    title: string;
    prompt: string;
    capabilityId?: string;
  }[];
  relatedAgents?: readonly string[];
  createdAt: string;
  updatedAt: string;
  expiresAt?: string;
};

export type DiscoverySignature = {
  algorithm: string;
  keyId: string;
  createdAt: string;
  expiresAt?: string;
  digest: string;
  value: string;
};

export type SignedAgentDiscoveryDocument = {
  document: AgentDiscoveryDocument;
  signatures: readonly DiscoverySignature[];
};

export type DiscoverySigner = {
  algorithm: string;
  keyId: string;
  sign(payload: Uint8Array): Promise<Uint8Array>;
};

export type DiscoveryVerifier = {
  verify(input: {
    algorithm: string;
    keyId: string;
    payload: Uint8Array;
    signature: Uint8Array;
  }): Promise<boolean>;
};

export type VerificationResult = {
  ok: boolean;
  validKeyIds: readonly string[];
  errors: readonly string[];
};

export type AgentRecord = {
  signed: SignedAgentDiscoveryDocument;
  verified: boolean;
  firstSeenAt: string;
  lastSeenAt: string;
};

export type AgentSearchQuery = {
  text?: string;
  capability?: string;
  tags?: readonly string[];
  categories?: readonly string[];
  languages?: readonly string[];
  interfaces?: readonly AgentInterface["type"][];
  paymentProtocols?: readonly string[];
  verifiedOnly?: boolean;
  limit?: number;
  cursor?: string;
};

export type AgentSearchResult = {
  agent: AgentDiscoveryDocument;
  verified: boolean;
  score: number;
  matched: readonly string[];
};

export type AgentRegistryMetadata = {
  schema: "https://absolutejs.com/schemas/agent-registry/v1";
  name: string;
  description: string;
  searchEndpoint: string;
  submissionEndpoint?: string;
  supportedDiscoverySchemas: readonly string[];
  requiresVerifiedSignatures: boolean;
  federationFeeds?: readonly string[];
};

export type AgentRegistryStore = {
  get(id: string): Promise<AgentRecord | undefined>;
  upsert(record: AgentRecord): Promise<void>;
  remove(id: string): Promise<boolean>;
  list(query: AgentSearchQuery): Promise<readonly AgentRecord[]>;
};
