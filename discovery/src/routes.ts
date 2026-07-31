import { sha256 } from "./canonical";
import {
  agentSitemap,
  agentsText,
  discoveryIndex,
  json,
  toA2AAgentCard,
  toJsonLd,
} from "./presentation";
import {
  A2A_AGENT_CARD_PATH,
  ABSOLUTE_AGENT_PATH,
  ABSOLUTE_AGENTS_PATH,
  AGENT_SITEMAP_PATH,
  AGENTS_TEXT_PATH,
  type SignedAgentDiscoveryDocument,
} from "./types";

export type DiscoveryHandlerOptions = {
  documents: readonly SignedAgentDiscoveryDocument[];
  cacheControl?: string;
};

const response = (
  body: string,
  type: string,
  cacheControl: string,
  etag?: string,
  links?: string,
) =>
  new Response(body, {
    headers: {
      "access-control-allow-origin": "*",
      "cache-control": cacheControl,
      "content-type": type,
      ...(etag ? { etag: `\"${etag}\"` } : {}),
      ...(links ? { link: links } : {}),
      "x-content-type-options": "nosniff",
      "x-robots-tag": "index, follow",
    },
  });

export const createAgentDiscoveryHandler =
  ({
    documents,
    cacheControl = "public, max-age=300, stale-while-revalidate=3600",
  }: DiscoveryHandlerOptions) =>
  async (request: Request) => {
    if (request.method !== "GET" && request.method !== "HEAD")
      return new Response(null, {
        status: 405,
        headers: { allow: "GET, HEAD" },
      });
    const path = new URL(request.url).pathname;
    const primary = documents[0];
    let body: string | undefined;
    let type = "application/json; charset=utf-8";
    if (path === ABSOLUTE_AGENT_PATH && primary) body = json(primary);
    else if (path === ABSOLUTE_AGENTS_PATH)
      body = json(discoveryIndex(documents));
    else if (path === A2A_AGENT_CARD_PATH && primary) {
      const card = toA2AAgentCard(primary.document);
      if (card) body = json(card);
    } else if (path === AGENTS_TEXT_PATH) {
      body = agentsText(documents.map(({ document }) => document));
      type = "text/plain; charset=utf-8";
    } else if (path === AGENT_SITEMAP_PATH) {
      body = agentSitemap(documents.map(({ document }) => document));
      type = "application/xml; charset=utf-8";
    } else if (path === "/.well-known/absolute-agent.jsonld" && primary) {
      body = json(toJsonLd(primary.document));
      type = "application/ld+json; charset=utf-8";
    }
    if (body === undefined) return new Response("Not Found", { status: 404 });
    const origin = new URL(request.url).origin;
    const links = [
      `<${origin}${ABSOLUTE_AGENT_PATH}>; rel=\"describedby\"; type=\"application/json\"`,
      `<${origin}${ABSOLUTE_AGENTS_PATH}>; rel=\"index\"; type=\"application/json\"`,
      `<${origin}${AGENT_SITEMAP_PATH}>; rel=\"sitemap\"; type=\"application/xml\"`,
    ].join(", ");
    const outgoing = response(
      request.method === "HEAD" ? "" : body,
      type,
      cacheControl,
      await sha256(body),
      links,
    );
    return outgoing;
  };
