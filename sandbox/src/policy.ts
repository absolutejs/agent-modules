import { isAbsolute, normalize, relative, resolve } from "node:path";
import type {
  AgentCapability,
  AgentSandboxAction,
  FilesystemCapability,
  HttpCapability,
  ProcessCapability,
} from "./types";

const byteLength = (value: string | Uint8Array | undefined) =>
  value === undefined
    ? 0
    : typeof value === "string"
      ? new TextEncoder().encode(value).byteLength
      : value.byteLength;

const within = (root: string, requested: string) => {
  if (!isAbsolute(root) || !isAbsolute(requested)) return false;
  const remainder = relative(resolve(root), resolve(normalize(requested)));
  return (
    remainder === "" || (!remainder.startsWith("..") && !isAbsolute(remainder))
  );
};

const originMatches = (allowed: string, url: URL) => {
  const candidate = new URL(allowed.replace("*.", "placeholder."));
  if (candidate.protocol !== url.protocol || candidate.port !== url.port)
    return false;
  if (!allowed.includes("*.")) return candidate.hostname === url.hostname;
  const suffix = candidate.hostname.slice("placeholder".length);
  return url.hostname.endsWith(suffix) && url.hostname.length > suffix.length;
};

const checkCredentials = (
  allowed: Record<string, string[]> | undefined,
  requested: Record<string, string> | undefined,
  normalizeName: (value: string) => string,
) => {
  for (const [name, alias] of Object.entries(requested ?? {})) {
    const normalized = normalizeName(name);
    const binding = Object.entries(allowed ?? {}).find(
      ([candidate]) => normalizeName(candidate) === normalized,
    )?.[1];
    if (!binding?.includes(alias))
      throw new Error(`Credential binding is not granted: ${name} -> ${alias}`);
  }
};

const authorizeHttp = (
  capability: HttpCapability,
  action: Extract<AgentSandboxAction, { kind: "http" }>,
) => {
  const url = new URL(action.url);
  if (url.username || url.password)
    throw new Error("HTTP URL credentials are denied");
  if (
    url.protocol !== "https:" &&
    !(
      url.protocol === "http:" &&
      ["localhost", "127.0.0.1", "::1"].includes(url.hostname)
    )
  )
    throw new Error("HTTP capability requires HTTPS except on loopback");
  if (!capability.origins.some((origin) => originMatches(origin, url)))
    throw new Error("HTTP origin is not granted");
  if (
    capability.methods &&
    !capability.methods
      .map((value) => value.toUpperCase())
      .includes(action.method.toUpperCase())
  )
    throw new Error("HTTP method is not granted");
  if (
    capability.pathPrefixes &&
    !capability.pathPrefixes.some(
      (prefix) =>
        decodeURIComponent(url.pathname) === prefix ||
        decodeURIComponent(url.pathname).startsWith(
          prefix.endsWith("/") ? prefix : `${prefix}/`,
        ),
    )
  )
    throw new Error("HTTP path is not granted");
  const forbiddenHeaders = new Set([
    "authorization",
    "proxy-authorization",
    "cookie",
    "host",
    "connection",
    "content-length",
    "transfer-encoding",
  ]);
  for (const name of Object.keys(action.headers ?? {})) {
    if (forbiddenHeaders.has(name.toLowerCase()))
      throw new Error(
        `Sensitive HTTP header must use a credential alias: ${name}`,
      );
  }
  if (byteLength(action.body) > (capability.maxRequestBytes ?? 1_048_576))
    throw new Error("HTTP request body exceeds grant");
  for (const name of Object.keys(action.credentials ?? {})) {
    if (
      forbiddenHeaders.has(name.toLowerCase()) &&
      name.toLowerCase() !== "authorization"
    )
      throw new Error(`Credential target header is denied: ${name}`);
  }
  checkCredentials(capability.credentialBindings, action.credentials, (value) =>
    value.toLowerCase(),
  );
};

const authorizeFilesystem = (
  capability: FilesystemCapability,
  action: Extract<AgentSandboxAction, { kind: "filesystem" }>,
) => {
  const root = capability.roots.find(
    (entry) =>
      within(entry.path, action.path) &&
      (entry.access === "read-write" || entry.access === action.operation),
  );
  if (!root) throw new Error("Filesystem path or operation is not granted");
  if (
    action.operation === "write" &&
    byteLength(action.data) > (capability.maxWriteBytes ?? 1_048_576)
  )
    throw new Error("Filesystem write exceeds grant");
};

const startsWithArgs = (args: string[], prefix: string[]) =>
  prefix.every((value, index) => args[index] === value);
const authorizeProcess = (
  capability: ProcessCapability,
  action: Extract<AgentSandboxAction, { kind: "process" }>,
) => {
  if (!capability.executables.includes(action.executable))
    throw new Error("Executable is not granted");
  if (
    capability.argumentPrefixes &&
    !capability.argumentPrefixes.some((prefix) =>
      startsWithArgs(action.args, prefix),
    )
  )
    throw new Error("Process arguments are not granted");
  if (
    action.cwd &&
    !capability.workingDirectories?.some((root) => within(root, action.cwd!))
  )
    throw new Error("Working directory is not granted");
  const forbiddenCredentialTargets = new Set([
    "PATH",
    "LD_PRELOAD",
    "NODE_OPTIONS",
    "BUN_OPTIONS",
  ]);
  for (const name of Object.keys(action.credentials ?? {})) {
    if (
      forbiddenCredentialTargets.has(name.toUpperCase()) ||
      name.toUpperCase().startsWith("DYLD_")
    )
      throw new Error(`Process credential target is denied: ${name}`);
  }
  checkCredentials(
    capability.credentialBindings,
    action.credentials,
    (value) => value,
  );
};

export const authorizeAgentSandboxAction = (
  capability: AgentCapability,
  action: AgentSandboxAction,
): void => {
  if (capability.kind !== action.kind)
    throw new Error("Capability kind does not match action");
  if (capability.kind === "http" && action.kind === "http")
    return authorizeHttp(capability, action);
  if (capability.kind === "filesystem" && action.kind === "filesystem")
    return authorizeFilesystem(capability, action);
  if (capability.kind === "process" && action.kind === "process")
    return authorizeProcess(capability, action);
  throw new Error("Unsupported sandbox action");
};
