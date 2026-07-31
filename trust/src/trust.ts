import type {
  AgentAuthority,
  AgentContentPurpose,
  AgentProofVerifier,
  AgentProvenance,
  AgentTaint,
  AgentTrustSinkPolicy,
  TrustedAgentValue,
} from "./types";

const unique = <Value>(values: readonly Value[]) => [...new Set(values)];
const encoder = new TextEncoder();
const stable = (value: unknown): string =>
  JSON.stringify(value, (_key, item) =>
    item && typeof item === "object" && !Array.isArray(item)
      ? Object.fromEntries(
          Object.entries(item).sort(([a], [b]) => a.localeCompare(b)),
        )
      : item,
  );
export const digestAgentValue = async (value: unknown) =>
  `sha256:${Buffer.from(await crypto.subtle.digest("SHA-256", encoder.encode(stable(value)))).toString("hex")}`;

export const trustAgentValue = <Value>(
  value: Value,
  labels: {
    purpose: AgentContentPurpose;
    authority: AgentAuthority;
    provenance: AgentProvenance;
    taints?: AgentTaint[];
  },
): TrustedAgentValue<Value> => ({
  value,
  purpose: labels.purpose,
  authority: labels.authority,
  provenance: structuredClone(labels.provenance),
  taints: unique(labels.taints ?? []),
  transformations: [],
});

export const deriveAgentValue = <Value>(
  value: Value,
  parents: readonly TrustedAgentValue[],
  input: {
    purpose: AgentContentPurpose;
    authority?: AgentAuthority;
    transformation: { id: string; at: string; evidence?: unknown };
    provenance: Omit<AgentProvenance, "parentDigests">;
  },
): TrustedAgentValue<Value> => ({
  value,
  purpose: input.purpose,
  authority:
    input.authority ??
    (parents.every((parent) => parent.authority === parents[0]?.authority)
      ? (parents[0]?.authority ?? "model")
      : "model"),
  taints: unique(
    parents.flatMap((parent) => parent.taints).concat("model-generated"),
  ),
  provenance: {
    ...input.provenance,
    parentDigests: parents.flatMap((parent) =>
      parent.provenance.digest ? [parent.provenance.digest] : [],
    ),
  },
  transformations: [
    ...parents.flatMap((parent) => parent.transformations),
    input.transformation,
  ],
});

export const withAgentValueDigest = async <Value>(
  input: TrustedAgentValue<Value>,
): Promise<TrustedAgentValue<Value>> => ({
  ...structuredClone(input),
  provenance: {
    ...input.provenance,
    digest: await digestAgentValue(input.value),
  },
});

export const sanitizeAgentValue = async <Value>(
  input: TrustedAgentValue<Value>,
  sanitizer: {
    id: string;
    removes: AgentTaint[];
    run(
      value: Value,
    ):
      | Promise<{ value: Value; evidence: unknown }>
      | { value: Value; evidence: unknown };
  },
  at = new Date().toISOString(),
): Promise<TrustedAgentValue<Value>> => {
  const result = await sanitizer.run(input.value);
  if (result.evidence === undefined)
    throw new Error("Sanitizer must return evidence");
  return {
    ...structuredClone(input),
    value: result.value,
    taints: input.taints.filter((taint) => !sanitizer.removes.includes(taint)),
    transformations: [
      ...input.transformations,
      { id: sanitizer.id, at, evidence: result.evidence },
    ],
    provenance: {
      ...input.provenance,
      digest: await digestAgentValue(result.value),
      parentDigests: unique([
        ...(input.provenance.parentDigests ?? []),
        ...(input.provenance.digest ? [input.provenance.digest] : []),
      ]),
    },
  };
};

export const enforceAgentTrustPolicy = async (
  input: TrustedAgentValue,
  policy: AgentTrustSinkPolicy,
  verifyProof?: AgentProofVerifier,
): Promise<void> => {
  if (!policy.allowedPurposes.includes(input.purpose))
    throw new Error(`Purpose ${input.purpose} is denied at ${policy.sink}`);
  if (
    policy.allowedAuthorities &&
    !policy.allowedAuthorities.includes(input.authority)
  )
    throw new Error(`Authority ${input.authority} is denied at ${policy.sink}`);
  const denied = input.taints.find((taint) =>
    policy.deniedTaints?.includes(taint),
  );
  if (denied) throw new Error(`Taint ${denied} is denied at ${policy.sink}`);
  if (policy.requireDigest && !input.provenance.digest)
    throw new Error(`A provenance digest is required at ${policy.sink}`);
  if (
    policy.requireVerifiedProof &&
    (!verifyProof || !(await verifyProof(input.provenance)))
  )
    throw new Error(`Verified provenance is required at ${policy.sink}`);
};

export const AGENT_INSTRUCTION_POLICY: AgentTrustSinkPolicy = {
  sink: "agent.instructions",
  allowedPurposes: ["instruction"],
  allowedAuthorities: ["system", "developer", "user", "delegated"],
  deniedTaints: ["external", "unverified", "prompt-injection-suspected"],
};
export const AGENT_ACTION_POLICY: AgentTrustSinkPolicy = {
  sink: "agent.actions",
  allowedPurposes: ["data", "tool-output", "memory"],
  deniedTaints: ["secret", "prompt-injection-suspected", "executable"],
  requireDigest: true,
};
