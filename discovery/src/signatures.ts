import { canonicalBytes, sha256 } from "./canonical";
import type {
  AgentDiscoveryDocument,
  DiscoverySignature,
  DiscoverySigner,
  DiscoveryVerifier,
  SignedAgentDiscoveryDocument,
  VerificationResult,
} from "./types";
import { validateAgentDocument } from "./validation";

const encode = (value: Uint8Array) => Buffer.from(value).toString("base64url");
const decode = (value: string) =>
  new Uint8Array(Buffer.from(value, "base64url"));

const signaturePayload = (
  document: AgentDiscoveryDocument,
  signature: Omit<DiscoverySignature, "value">,
) => canonicalBytes({ document, signature });

export const signAgentDocument = async (
  document: AgentDiscoveryDocument,
  signer: DiscoverySigner,
  options: { createdAt?: string; expiresAt?: string } = {},
): Promise<SignedAgentDiscoveryDocument> => {
  const errors = validateAgentDocument(document);
  if (errors.length)
    throw new Error(`Invalid agent discovery document: ${errors.join(", ")}`);
  const unsigned: Omit<DiscoverySignature, "value"> = {
    algorithm: signer.algorithm,
    keyId: signer.keyId,
    createdAt: options.createdAt ?? new Date().toISOString(),
    ...(options.expiresAt ? { expiresAt: options.expiresAt } : {}),
    digest: await sha256(document),
  };
  return {
    document,
    signatures: [
      {
        ...unsigned,
        value: encode(await signer.sign(signaturePayload(document, unsigned))),
      },
    ],
  };
};

export const addAgentSignature = async (
  signed: SignedAgentDiscoveryDocument,
  signer: DiscoverySigner,
): Promise<SignedAgentDiscoveryDocument> => {
  const next = await signAgentDocument(signed.document, signer);
  return {
    document: signed.document,
    signatures: [...signed.signatures, ...next.signatures],
  };
};

export const verifyAgentDocument = async (
  signed: SignedAgentDiscoveryDocument,
  verifier: DiscoveryVerifier,
  now = Date.now(),
): Promise<VerificationResult> => {
  const errors = [...validateAgentDocument(signed.document, now)];
  const validKeyIds: string[] = [];
  const digest = await sha256(signed.document);
  for (const signature of signed.signatures) {
    if (signature.digest !== digest) {
      errors.push(`digest mismatch for ${signature.keyId}`);
      continue;
    }
    if (signature.expiresAt && Date.parse(signature.expiresAt) <= now) {
      errors.push(`signature expired for ${signature.keyId}`);
      continue;
    }
    const { value, ...unsigned } = signature;
    const valid = await verifier.verify({
      algorithm: signature.algorithm,
      keyId: signature.keyId,
      payload: signaturePayload(signed.document, unsigned),
      signature: decode(value),
    });
    if (valid) validKeyIds.push(signature.keyId);
    else errors.push(`invalid signature for ${signature.keyId}`);
  }
  if (!signed.signatures.length) errors.push("document is unsigned");
  return {
    ok: errors.length === 0 && validKeyIds.length > 0,
    validKeyIds,
    errors,
  };
};
