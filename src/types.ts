export type AgentAuthority =
  | "system"
  | "developer"
  | "user"
  | "delegated"
  | "tool"
  | "external"
  | "model";
export type AgentContentPurpose =
  | "instruction"
  | "data"
  | "tool-output"
  | "memory"
  | "credential";
export type AgentTaint =
  | "external"
  | "user-controlled"
  | "model-generated"
  | "unverified"
  | "personal"
  | "secret"
  | "financial"
  | "executable"
  | "prompt-injection-suspected";

export type AgentProvenance = {
  source: string;
  sourceType: "user" | "agent" | "tool" | "web" | "file" | "memory" | "system";
  producer?: string;
  retrievedAt: string;
  digest?: string;
  parentDigests?: string[];
  proof?: unknown;
};

export type TrustedAgentValue<Value = unknown> = {
  value: Value;
  purpose: AgentContentPurpose;
  authority: AgentAuthority;
  taints: AgentTaint[];
  provenance: AgentProvenance;
  transformations: Array<{ id: string; at: string; evidence?: unknown }>;
};

export type AgentTrustSinkPolicy = {
  sink: string;
  allowedPurposes: AgentContentPurpose[];
  allowedAuthorities?: AgentAuthority[];
  deniedTaints?: AgentTaint[];
  requireDigest?: boolean;
  requireVerifiedProof?: boolean;
};

export type AgentProofVerifier = (
  provenance: AgentProvenance,
) => boolean | Promise<boolean>;
