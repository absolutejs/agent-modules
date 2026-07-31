import { AGENT_INSTRUCTION_POLICY, enforceAgentTrustPolicy } from "./trust";
import type {
  AgentProofVerifier,
  AgentTrustSinkPolicy,
  TrustedAgentValue,
} from "./types";

export type AgentContextSegment = {
  channel: "instructions" | "data";
  content: string;
  metadata: {
    authority: string;
    source: string;
    digest?: string;
    taints: string[];
  };
};

/**
 * Produces structured segments so providers can map trusted instructions and
 * untrusted data to separate message/content channels. It never concatenates
 * external data into an instruction string.
 */
export const compileAgentContext = (
  values: readonly TrustedAgentValue[],
): AgentContextSegment[] =>
  values.map((item) => ({
    channel:
      item.purpose === "instruction" &&
      AGENT_INSTRUCTION_POLICY.allowedAuthorities?.includes(item.authority) &&
      !item.taints.some((taint) =>
        AGENT_INSTRUCTION_POLICY.deniedTaints?.includes(taint),
      )
        ? "instructions"
        : "data",
    content:
      typeof item.value === "string" ? item.value : JSON.stringify(item.value),
    metadata: {
      authority: item.authority,
      source: item.provenance.source,
      digest: item.provenance.digest,
      taints: [...item.taints],
    },
  }));

/** Enforces sink policy before compiling provider context. */
export const compileGuardedAgentContext = async ({
  values,
  instructionPolicy = AGENT_INSTRUCTION_POLICY,
  dataPolicy,
  verifyProof,
}: {
  values: readonly TrustedAgentValue[];
  instructionPolicy?: AgentTrustSinkPolicy;
  dataPolicy?: AgentTrustSinkPolicy;
  verifyProof?: AgentProofVerifier;
}): Promise<AgentContextSegment[]> => {
  for (const value of values) {
    if (value.purpose === "instruction")
      await enforceAgentTrustPolicy(value, instructionPolicy, verifyProof);
    else if (dataPolicy)
      await enforceAgentTrustPolicy(value, dataPolicy, verifyProof);
  }

  return compileAgentContext(values);
};

export const detectPromptInjection = async <Value>(
  input: TrustedAgentValue<Value>,
  detector: (value: Value) => boolean | Promise<boolean>,
): Promise<TrustedAgentValue<Value>> =>
  (await detector(input.value))
    ? {
        ...structuredClone(input),
        taints: [
          ...new Set([...input.taints, "prompt-injection-suspected" as const]),
        ],
      }
    : structuredClone(input);
