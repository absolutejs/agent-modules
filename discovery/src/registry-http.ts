import { json } from "./presentation";
import type {
  AgentRegistryMetadata,
  AgentSearchQuery,
  SignedAgentDiscoveryDocument,
} from "./types";
import {
  ABSOLUTE_AGENT_SCHEMA,
  AGENT_REGISTRY_PATH,
  AGENT_SEARCH_PATH,
} from "./types";

type Registry = {
  publish(document: SignedAgentDiscoveryDocument): Promise<unknown>;
  get(id: string): Promise<unknown>;
  search(query: AgentSearchQuery): Promise<unknown>;
};

const values = (params: URLSearchParams, key: string) => {
  const entries = params.getAll(key).flatMap((value) => value.split(","));
  return entries.length
    ? entries.map((value) => value.trim()).filter(Boolean)
    : undefined;
};

const jsonResponse = (
  value: unknown,
  status = 200,
  headers: HeadersInit = {},
) =>
  new Response(json(value), {
    status,
    headers: {
      "access-control-allow-origin": "*",
      "content-type": "application/json; charset=utf-8",
      "x-content-type-options": "nosniff",
      ...headers,
    },
  });

export const createAgentRegistryHandler =
  ({
    registry,
    metadata,
    authorizePublish = async () => false,
    maxSubmissionBytes = 256 * 1024,
  }: {
    registry: Registry;
    metadata: Omit<
      AgentRegistryMetadata,
      "schema" | "supportedDiscoverySchemas"
    > &
      Partial<Pick<AgentRegistryMetadata, "supportedDiscoverySchemas">>;
    authorizePublish?: (
      request: Request,
      document: SignedAgentDiscoveryDocument,
    ) => boolean | Promise<boolean>;
    maxSubmissionBytes?: number;
  }) =>
  async (request: Request) => {
    const url = new URL(request.url);
    if (request.method === "OPTIONS")
      return new Response(null, {
        status: 204,
        headers: {
          "access-control-allow-origin": "*",
          "access-control-allow-methods": "GET, HEAD, POST, OPTIONS",
          "access-control-allow-headers": "authorization, content-type",
        },
      });
    if (
      url.pathname === AGENT_REGISTRY_PATH &&
      (request.method === "GET" || request.method === "HEAD")
    ) {
      const body: AgentRegistryMetadata = {
        schema: "https://absolutejs.com/schemas/agent-registry/v1",
        supportedDiscoverySchemas: metadata.supportedDiscoverySchemas ?? [
          ABSOLUTE_AGENT_SCHEMA,
        ],
        ...metadata,
      };
      return request.method === "HEAD"
        ? new Response(null, { status: 200 })
        : jsonResponse(body, 200, { "cache-control": "public, max-age=300" });
    }
    if (url.pathname !== AGENT_SEARCH_PATH)
      return new Response("Not Found", { status: 404 });
    if (request.method === "GET" || request.method === "HEAD") {
      const id = url.searchParams.get("id");
      if (id) {
        const record = await registry.get(id);
        return record
          ? jsonResponse(record)
          : jsonResponse({ error: "agent_not_found" }, 404);
      }
      const limitValue = url.searchParams.get("limit");
      const query: AgentSearchQuery = {
        text: url.searchParams.get("q") ?? undefined,
        capability: url.searchParams.get("capability") ?? undefined,
        tags: values(url.searchParams, "tag"),
        categories: values(url.searchParams, "category"),
        languages: values(url.searchParams, "language"),
        interfaces: values(
          url.searchParams,
          "interface",
        ) as AgentSearchQuery["interfaces"],
        paymentProtocols: values(url.searchParams, "payment"),
        verifiedOnly: url.searchParams.get("verified") !== "false",
        limit: limitValue ? Number.parseInt(limitValue, 10) : undefined,
        cursor: url.searchParams.get("cursor") ?? undefined,
      };
      const result = await registry.search(query);
      return request.method === "HEAD"
        ? new Response(null, { status: 200 })
        : jsonResponse(result, 200, { "cache-control": "public, max-age=30" });
    }
    if (request.method === "POST") {
      const length = Number(request.headers.get("content-length") ?? "0");
      if (length > maxSubmissionBytes)
        return jsonResponse({ error: "submission_too_large" }, 413);
      const bytes = new Uint8Array(await request.arrayBuffer());
      if (bytes.byteLength > maxSubmissionBytes)
        return jsonResponse({ error: "submission_too_large" }, 413);
      let document: SignedAgentDiscoveryDocument;
      try {
        document = JSON.parse(
          new TextDecoder().decode(bytes),
        ) as SignedAgentDiscoveryDocument;
      } catch {
        return jsonResponse({ error: "invalid_json" }, 400);
      }
      if (!(await authorizePublish(request, document)))
        return jsonResponse({ error: "submission_not_authorized" }, 403);
      try {
        const verification = await registry.publish(document);
        return jsonResponse(
          { accepted: true, id: document.document.id, verification },
          202,
          {
            location: `${AGENT_SEARCH_PATH}?id=${encodeURIComponent(document.document.id)}`,
          },
        );
      } catch (error) {
        return jsonResponse(
          {
            error: "invalid_agent_document",
            message:
              error instanceof Error ? error.message : "Invalid agent document",
          },
          400,
        );
      }
    }
    return new Response(null, {
      status: 405,
      headers: { allow: "GET, HEAD, POST, OPTIONS" },
    });
  };

export const submitAgentDocument = async ({
  registryUrl,
  document,
  fetch: fetcher,
  authorization,
}: {
  registryUrl: string;
  document: SignedAgentDiscoveryDocument;
  fetch: (input: string | URL, init?: RequestInit) => Promise<Response>;
  authorization?: string;
}) => {
  const endpoint = new URL(AGENT_SEARCH_PATH, registryUrl);
  if (endpoint.protocol !== "https:")
    throw new Error("Agent registry submission requires HTTPS");
  const response = await fetcher(endpoint, {
    method: "POST",
    redirect: "error",
    headers: {
      "content-type": "application/json",
      ...(authorization ? { authorization } : {}),
    },
    body: json(document),
  });
  if (!response.ok)
    throw new Error(
      `Agent registry rejected submission with ${response.status}`,
    );
  return response.json() as Promise<{ accepted: true; id: string }>;
};
