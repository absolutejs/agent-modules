import type { SignedAgentDiscoveryDocument } from "./types";
import { validateAgentDocument } from "./validation";

export type DiscoveryFetch = (
  input: string | URL,
  init?: RequestInit,
) => Promise<Response>;

export const fetchAgentDocument = async ({
  url,
  fetch: fetcher,
  maxBytes = 256 * 1024,
  timeoutMs = 10_000,
}: {
  url: string;
  fetch: DiscoveryFetch;
  maxBytes?: number;
  timeoutMs?: number;
}): Promise<SignedAgentDiscoveryDocument> => {
  const target = new URL(url);
  if (target.protocol !== "https:" || target.username || target.password)
    throw new Error("Agent discovery requires HTTPS without credentials");
  const response = await fetcher(target, {
    headers: { accept: "application/json" },
    redirect: "error",
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok)
    throw new Error(`Agent discovery failed with ${response.status}`);
  if (
    !(response.headers.get("content-type")?.toLowerCase() ?? "").includes(
      "application/json",
    )
  )
    throw new Error("Agent discovery response is not JSON");
  const length = Number(response.headers.get("content-length") ?? "0");
  if (length > maxBytes)
    throw new Error("Agent discovery document exceeds byte limit");
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > maxBytes)
    throw new Error("Agent discovery document exceeds byte limit");
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new Error("Agent discovery response contains invalid JSON");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
    throw new Error("Agent discovery envelope is invalid");
  const signed = parsed as Partial<SignedAgentDiscoveryDocument>;
  if (
    typeof signed.document !== "object" ||
    signed.document === null ||
    !Array.isArray(signed.signatures) ||
    signed.signatures.length === 0
  )
    throw new Error("Agent discovery envelope is invalid");
  const errors = validateAgentDocument(signed.document);
  if (errors.length > 0)
    throw new Error(
      `Agent discovery document is invalid: ${errors.join(", ")}`,
    );
  for (const signature of signed.signatures) {
    if (
      !signature ||
      typeof signature.algorithm !== "string" ||
      typeof signature.keyId !== "string" ||
      typeof signature.createdAt !== "string" ||
      typeof signature.digest !== "string" ||
      typeof signature.value !== "string"
    )
      throw new Error("Agent discovery signature is invalid");
  }
  return signed as SignedAgentDiscoveryDocument;
};
