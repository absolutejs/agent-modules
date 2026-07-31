import type {
  AgentReputationAssessment,
  AgentReputationEvidence,
  AgentReputationServiceOptions,
} from "./types";

export class AgentReputationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AgentReputationError";
  }
}

const validIdentifier = (value: string) => {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "did:";
  } catch {
    return value.startsWith("urn:");
  }
};

const validateEvidence = (evidence: AgentReputationEvidence) => {
  if (!evidence.evidenceId || !evidence.scope)
    throw new AgentReputationError("Evidence ID and scope are required");
  if (!validIdentifier(evidence.subject) || !validIdentifier(evidence.issuer))
    throw new AgentReputationError(
      "Evidence subject and issuer must be stable identifiers",
    );
  if (
    !Number.isFinite(evidence.value) ||
    evidence.value < -1 ||
    evidence.value > 1
  )
    throw new AgentReputationError("Evidence value must be between -1 and 1");
  if (
    !Number.isFinite(evidence.confidence) ||
    evidence.confidence <= 0 ||
    evidence.confidence > 1
  )
    throw new AgentReputationError(
      "Evidence confidence must be greater than 0 and at most 1",
    );
  const issuedAt = Date.parse(evidence.issuedAt);
  if (!Number.isFinite(issuedAt))
    throw new AgentReputationError("Evidence issuedAt is invalid");
  if (evidence.expiresAt && Date.parse(evidence.expiresAt) <= issuedAt)
    throw new AgentReputationError("Evidence expiration must follow issuance");
};

export const createAgentReputation = (
  options: AgentReputationServiceOptions,
) => {
  const now = options.now ?? Date.now;
  const record = async (evidence: AgentReputationEvidence) => {
    validateEvidence(evidence);
    if (Date.parse(evidence.issuedAt) > now() + 300_000)
      throw new AgentReputationError("Evidence issuance is in the future");
    const verified = options.verifyEvidence
      ? await options.verifyEvidence(structuredClone(evidence))
      : false;
    if (!verified && options.allowUnverified !== true)
      throw new AgentReputationError(
        "Evidence could not be cryptographically verified",
      );
    await options.store.put({
      ...structuredClone(evidence),
      recordedAt: new Date(now()).toISOString(),
      verified,
    });
  };

  const assess = async (
    subject: string,
    scope: string,
  ): Promise<AgentReputationAssessment> => {
    if (!scope)
      throw new AgentReputationError("A reputation scope is required");
    const current = now();
    const grouped = new Map<
      string,
      Awaited<ReturnType<typeof options.store.list>>
    >();
    for (const evidence of await options.store.list(subject, scope)) {
      if (
        evidence.revokedAt ||
        (!evidence.verified && options.allowUnverified !== true) ||
        (evidence.expiresAt && Date.parse(evidence.expiresAt) <= current)
      )
        continue;
      const issuerEvidence = grouped.get(evidence.issuer) ?? [];
      issuerEvidence.push(evidence);
      grouped.set(evidence.issuer, issuerEvidence);
    }
    const selected = [...grouped.values()].flatMap((items) =>
      items
        .sort((left, right) => right.issuedAt.localeCompare(left.issuedAt))
        .slice(0, options.maxEvidencePerIssuer ?? 20),
    );
    const halfLife = options.halfLifeMs ?? 90 * 24 * 60 * 60 * 1_000;
    let positiveWeight = 0;
    let negativeWeight = 0;
    for (const evidence of selected) {
      const age = Math.max(0, current - Date.parse(evidence.issuedAt));
      const decay = 2 ** (-age / halfLife);
      const issuerWeight = Math.max(
        0,
        Math.min(1, options.issuerWeights?.[evidence.issuer] ?? 1),
      );
      const weight = evidence.confidence * decay * issuerWeight;
      positiveWeight += Math.max(0, evidence.value) * weight;
      negativeWeight += Math.max(0, -evidence.value) * weight;
    }
    const prior = Math.max(0.1, options.priorStrength ?? 2);
    const alpha = prior / 2 + positiveWeight;
    const beta = prior / 2 + negativeWeight;
    return {
      confidence: Number(
        (1 - prior / (prior + positiveWeight + negativeWeight)).toFixed(6),
      ),
      evidenceCount: selected.length,
      generatedAt: new Date(current).toISOString(),
      issuerCount: grouped.size,
      negativeWeight: Number(negativeWeight.toFixed(6)),
      positiveWeight: Number(positiveWeight.toFixed(6)),
      score: Number(((alpha / (alpha + beta)) * 100).toFixed(4)),
      scope,
      subject,
    };
  };

  return {
    assess,
    record,
    revoke: async (evidenceId: string) =>
      options.store.revoke(evidenceId, new Date(now()).toISOString()),
  };
};
