import type { AgentSandboxAdapter, HttpCapability } from "./types";

export type AgentSandboxFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

const readLimited = async (response: Response, limit: number) => {
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > limit) throw new Error("HTTP response exceeds grant");
  return new TextDecoder().decode(bytes);
};

/** Fetch adapter with manual redirects so a granted origin cannot redirect elsewhere. */
export const createFetchAgentSandboxAdapter = ({
  fetch: fetcher = fetch,
}: { fetch?: AgentSandboxFetch } = {}): AgentSandboxAdapter => ({
  execute: async ({ capability, action, resolveCredential }) => {
    if (capability.kind !== "http" || action.kind !== "http")
      throw new Error("HTTP adapter received another action kind");
    const headers = new Headers(action.headers);
    for (const [header, alias] of Object.entries(action.credentials ?? {}))
      headers.set(header, await resolveCredential(alias));
    const response = await fetcher(action.url, {
      method: action.method,
      headers,
      body: action.body,
      redirect: "manual",
    });
    if (response.status >= 300 && response.status < 400)
      throw new Error("HTTP redirects are denied by the sandbox adapter");
    const body = await readLimited(
      response,
      (capability as HttpCapability).maxResponseBytes ?? 1_048_576,
    );
    return {
      status: response.status,
      headers: Object.fromEntries(response.headers),
      body,
    };
  },
});
