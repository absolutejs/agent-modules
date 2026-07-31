export type AgentReputationEvidence = {
  confidence: number;
  evidenceId: string;
  expiresAt?: string;
  issuedAt: string;
  issuer: string;
  kind:
    | "conformance"
    | "execution"
    | "policy-violation"
    | "security-incident"
    | "dispute-resolution"
    | (string & {});
  receiptDigest?: string;
  scope: string;
  subject: string;
  value: number;
};

export type StoredAgentReputationEvidence = AgentReputationEvidence & {
  recordedAt: string;
  revokedAt?: string;
  verified: boolean;
};

export type AgentReputationAssessment = {
  confidence: number;
  evidenceCount: number;
  generatedAt: string;
  issuerCount: number;
  negativeWeight: number;
  positiveWeight: number;
  score: number;
  scope: string;
  subject: string;
};

export type AgentReputationStore = {
  get: (
    evidenceId: string,
  ) => Promise<StoredAgentReputationEvidence | undefined>;
  list: (
    subject: string,
    scope: string,
  ) => Promise<StoredAgentReputationEvidence[]>;
  put: (evidence: StoredAgentReputationEvidence) => Promise<void>;
  revoke: (evidenceId: string, revokedAt: string) => Promise<boolean>;
};

export type AgentReputationCredential = {
  "@context": ["https://www.w3.org/ns/credentials/v2", string];
  credentialSubject: AgentReputationAssessment & { id: string };
  id: string;
  issuer: string;
  type: ["VerifiableCredential", "AgentReputationCredential"];
  validFrom: string;
  validUntil?: string;
};

export type AgentReputationServiceOptions = {
  allowUnverified?: boolean;
  halfLifeMs?: number;
  issuerWeights?: Record<string, number>;
  maxEvidencePerIssuer?: number;
  now?: () => number;
  priorStrength?: number;
  store: AgentReputationStore;
  verifyEvidence?: (
    evidence: AgentReputationEvidence,
  ) => Promise<boolean> | boolean;
};
