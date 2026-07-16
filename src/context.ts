import type { TrustedAgentValue } from "./types";

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
    channel: item.purpose === "instruction" ? "instructions" : "data",
    content:
      typeof item.value === "string" ? item.value : JSON.stringify(item.value),
    metadata: {
      authority: item.authority,
      source: item.provenance.source,
      digest: item.provenance.digest,
      taints: [...item.taints],
    },
  }));

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
