export type AgentIdentityPin = {
  descriptorId: string;
  descriptorVersion: string;
  descriptorDigest: string;
};

export type HttpCapability = {
  id: string;
  kind: "http";
  origins: string[];
  methods?: string[];
  pathPrefixes?: string[];
  /** Exact header name to permitted broker credential aliases. */
  credentialBindings?: Record<string, string[]>;
  maxRequestBytes?: number;
  maxResponseBytes?: number;
  maxUses?: number;
};

export type FilesystemCapability = {
  id: string;
  kind: "filesystem";
  roots: Array<{ path: string; access: "read" | "write" | "read-write" }>;
  maxWriteBytes?: number;
  maxReadBytes?: number;
  maxUses?: number;
};

export type ProcessCapability = {
  id: string;
  kind: "process";
  executables: string[];
  argumentPrefixes?: string[][];
  workingDirectories?: string[];
  /** Exact environment/input name to permitted broker credential aliases. */
  credentialBindings?: Record<string, string[]>;
  timeoutMs?: number;
  maxOutputBytes?: number;
  maxUses?: number;
};

export type AgentCapability =
  | HttpCapability
  | FilesystemCapability
  | ProcessCapability;

export type AgentCapabilityGrant = {
  id: string;
  runId: string;
  actor: {
    tenantId: string;
    userId: string;
    agentId: string;
    delegationId?: string;
  };
  agent: AgentIdentityPin;
  issuedAt: string;
  expiresAt: string;
  capabilities: AgentCapability[];
  issuer: string;
  proof?: unknown;
};

export type HttpAction = {
  kind: "http";
  capabilityId: string;
  requestId: string;
  url: string;
  method: string;
  headers?: Record<string, string>;
  body?: string | Uint8Array;
  credentials?: Record<string, string>;
};

export type FilesystemAction = {
  kind: "filesystem";
  capabilityId: string;
  requestId: string;
  operation: "read" | "write";
  path: string;
  data?: string | Uint8Array;
};

export type ProcessAction = {
  kind: "process";
  capabilityId: string;
  requestId: string;
  executable: string;
  args: string[];
  cwd?: string;
  credentials?: Record<string, string>;
};

export type AgentSandboxAction = HttpAction | FilesystemAction | ProcessAction;

export type AgentSandboxReceipt = {
  id: string;
  grantId: string;
  runId: string;
  requestId: string;
  capabilityId: string;
  kind: AgentSandboxAction["kind"];
  requestDigest: string;
  outputDigest: string;
  startedAt: string;
  completedAt: string;
};

export type AgentSandboxResult = {
  output: unknown;
  receipt: AgentSandboxReceipt;
};

export type AgentSandboxOperationStore = {
  begin(input: {
    grantId: string;
    capabilityId: string;
    requestId: string;
    maxUses?: number;
    now: string;
  }): Promise<
    | { state: "acquired" }
    | { state: "in_progress" }
    | { state: "limit_exceeded" }
    | { state: "completed"; result: AgentSandboxResult }
  >;
  complete(input: {
    grantId: string;
    requestId: string;
    result: AgentSandboxResult;
    now: string;
  }): Promise<boolean>;
  fail(input: { grantId: string; requestId: string }): Promise<void>;
};

export type AgentSandboxAdapter = {
  execute(input: {
    grant: AgentCapabilityGrant;
    capability: AgentCapability;
    action: AgentSandboxAction;
    resolveCredential(alias: string): Promise<string>;
  }): Promise<unknown>;
};

export type AgentSandbox = {
  execute(input: {
    grant: AgentCapabilityGrant;
    action: AgentSandboxAction;
  }): Promise<AgentSandboxResult>;
};
