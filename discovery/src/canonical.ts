const normalize = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, child]) => child !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, normalize(child)]),
    );
  }
  return value;
};

export const canonicalJson = (value: unknown) =>
  JSON.stringify(normalize(value));
export const canonicalBytes = (value: unknown) =>
  new TextEncoder().encode(canonicalJson(value));

export const sha256 = async (value: unknown) =>
  Buffer.from(
    await crypto.subtle.digest("SHA-256", canonicalBytes(value)),
  ).toString("base64url");
