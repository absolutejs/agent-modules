import {
  ABSOLUTE_AGENT_SCHEMA,
  ABSOLUTE_AGENT_SCHEMA_LEGACY,
  type AgentDiscoveryDocument,
  type AgentInterface,
} from "./types";

const HTTPS_FIELDS = [
  "id",
  "url",
  "statusUrl",
  "privacyUrl",
  "termsUrl",
  "iconUrl",
  "documentationUrl",
] as const;

const isHttpsUrl = (value: string) => {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password;
  } catch {
    return false;
  }
};

const unique = (values: readonly string[]) =>
  new Set(values).size === values.length;
const validInterfaces = new Set([
  "a2a",
  "arazzo",
  "http",
  "mcp",
  "openapi",
  "webmcp",
  "websocket",
]);

export const validateAgentDocument = (
  value: AgentDiscoveryDocument,
  now = Date.now(),
): readonly string[] => {
  const errors: string[] = [];
  if (
    value.$schema !== ABSOLUTE_AGENT_SCHEMA &&
    value.$schema !== ABSOLUTE_AGENT_SCHEMA_LEGACY
  )
    errors.push("unsupported schema");
  if (!value.name?.trim() || value.name.length > 200)
    errors.push("name is invalid");
  if (!value.description?.trim() || value.description.length > 10_000)
    errors.push("description is invalid");
  if (!value.version?.trim() || value.version.length > 100)
    errors.push("version is invalid");
  if (!value.publisher?.id || !value.publisher.name)
    errors.push("publisher is required");
  if (!Array.isArray(value.capabilities) || value.capabilities.length === 0)
    errors.push("at least one capability is required");
  if (value.capabilities?.length > 1_000) errors.push("too many capabilities");
  if (!Array.isArray(value.interfaces) || value.interfaces.length === 0)
    errors.push("at least one interface is required");
  if (value.interfaces?.length > 100) errors.push("too many interfaces");

  for (const field of HTTPS_FIELDS) {
    const candidate = value[field];
    if (candidate && !isHttpsUrl(candidate))
      errors.push(`${field} must be an HTTPS URL without credentials`);
  }
  for (const [field, candidate] of [
    ["publisher.id", value.publisher?.id],
    ["publisher.url", value.publisher?.url],
    ["publisher.jwksUri", value.publisher?.jwksUri],
    [
      "authentication.protectedResourceMetadata",
      value.authentication?.protectedResourceMetadata,
    ],
    ...(value.authentication?.authorizationServers ?? []).map(
      (candidate, index) => [
        `authentication.authorizationServers[${index}]`,
        candidate,
      ],
    ),
  ] as Array<[string, string | undefined]>) {
    if (candidate && !isHttpsUrl(candidate))
      errors.push(`${field} must be an HTTPS URL without credentials`);
  }

  for (const [index, item] of (value.interfaces ?? []).entries()) {
    if (!validInterfaces.has(item.type))
      errors.push(`interfaces[${index}].type is unsupported`);
    if (!isHttpsUrl(item.url))
      errors.push(
        `interfaces[${index}].url must be an HTTPS URL without credentials`,
      );
  }
  for (const [index, capability] of (value.capabilities ?? []).entries()) {
    if (!capability.id?.trim() || capability.id.length > 200)
      errors.push(`capabilities[${index}].id is invalid`);
    if (!capability.title?.trim() || capability.title.length > 500)
      errors.push(`capabilities[${index}].title is invalid`);
    if (
      !capability.description?.trim() ||
      capability.description.length > 10_000
    )
      errors.push(`capabilities[${index}].description is invalid`);
  }
  const capabilityIds = (value.capabilities ?? []).map(({ id }) => id);
  if (!unique(capabilityIds)) errors.push("capability ids must be unique");
  const interfaceIds = (value.interfaces ?? []).map(
    ({ type, url }) => `${type}\u0000${url}`,
  );
  if (!unique(interfaceIds)) errors.push("interfaces must be unique");

  if (value.expiresAt && Date.parse(value.expiresAt) <= now)
    errors.push("document expired");
  if (!Number.isFinite(Date.parse(value.createdAt)))
    errors.push("createdAt is invalid");
  if (!Number.isFinite(Date.parse(value.updatedAt)))
    errors.push("updatedAt is invalid");
  if (Date.parse(value.updatedAt) < Date.parse(value.createdAt))
    errors.push("updatedAt precedes createdAt");
  if (
    Date.parse(value.createdAt) > now + 300_000 ||
    Date.parse(value.updatedAt) > now + 300_000
  )
    errors.push("document timestamp is in the future");
  return errors;
};

export const interfaceOf = (
  document: AgentDiscoveryDocument,
  type: AgentInterface["type"],
) => document.interfaces.find((candidate) => candidate.type === type);
