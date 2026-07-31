import type {
  AgentReputationAssessment,
  AgentReputationCredential,
} from "./types";

export const AGENT_REPUTATION_CONTEXT =
  "https://absolutejs.github.io/agents/contexts/reputation/v1.json" as const;

export const createAgentReputationCredential = (input: {
  assessment: AgentReputationAssessment;
  id?: string;
  issuer: string;
  validUntil?: string;
}): AgentReputationCredential => ({
  "@context": [
    "https://www.w3.org/ns/credentials/v2",
    AGENT_REPUTATION_CONTEXT,
  ],
  credentialSubject: {
    ...structuredClone(input.assessment),
    id: input.assessment.subject,
  },
  id: input.id ?? `urn:uuid:${crypto.randomUUID()}`,
  issuer: input.issuer,
  type: ["VerifiableCredential", "AgentReputationCredential"],
  validFrom: input.assessment.generatedAt,
  ...(input.validUntil ? { validUntil: input.validUntil } : {}),
});

export const secureAgentReputationCredential = async <Secured>(
  credential: AgentReputationCredential,
  secure: (credential: AgentReputationCredential) => Promise<Secured> | Secured,
) => secure(structuredClone(credential));

export const verifyAgentReputationCredential = async (
  secured: unknown,
  verify: (
    secured: unknown,
  ) =>
    | Promise<AgentReputationCredential | undefined>
    | AgentReputationCredential
    | undefined,
) => {
  const credential = await verify(secured);
  if (!credential) return undefined;
  const current = Date.now();
  if (
    credential["@context"]?.[0] !== "https://www.w3.org/ns/credentials/v2" ||
    !credential.type?.includes("AgentReputationCredential") ||
    credential.credentialSubject.id !== credential.credentialSubject.subject ||
    !Number.isFinite(credential.credentialSubject.score) ||
    credential.credentialSubject.score < 0 ||
    credential.credentialSubject.score > 100 ||
    Date.parse(credential.validFrom) > current ||
    (credential.validUntil && Date.parse(credential.validUntil) <= current)
  )
    return undefined;
  return credential;
};
