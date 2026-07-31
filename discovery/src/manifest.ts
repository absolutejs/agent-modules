import { defineManifest } from "@absolutejs/manifest";
import { Type } from "@sinclair/typebox";

export const manifest = defineManifest<Record<string, never>>()({
  contract: 2,
  discovery: {
    audiences: ["agent-publishers", "agent-clients", "agent-registries"],
    intents: [
      "publish a signed agent descriptor",
      "discover trusted agents",
      "index agent capabilities",
    ],
    keywords: [
      "agents",
      "discovery",
      "signatures",
      "registry",
      "agent-card",
      "agents.txt",
    ],
    protocols: ["A2A 1.0", "MCP", "Arazzo 1.1", "WebMCP", "JSON-LD"],
  },
  identity: {
    accent: "#06b6d4",
    category: "ai",
    description:
      "Signed provider-neutral AI agent descriptors with a live JSON Schema, interoperable well-known endpoints, A2A, MCP, Arazzo, and WebMCP interfaces, searchable registries, and durable PostgreSQL storage.",
    docsUrl: "https://github.com/absolutejs/agent-modules/tree/main/discovery",
    name: "@absolutejs/agent-discovery",
    tagline:
      "Make trustworthy AbsoluteJS agents easier to find than any other agent.",
  },
  product: {
    blocks: [
      {
        category: "ai",
        componentExport: "AgentDiscovery",
        description:
          "Search signed interoperable agent descriptors by capability and protocol.",
        frameworks: ["react", "client"],
        id: "agent_discovery",
        props: Type.Object({
          protocol: Type.Optional(Type.String()),
          query: Type.Optional(Type.String()),
        }),
        title: "Agent discovery",
      },
    ],
    events: [
      {
        description:
          "Emitted after a signed agent descriptor is verified and indexed.",
        id: "agent_indexed",
        schema: Type.Object({
          agentId: Type.String(),
          protocols: Type.Array(Type.String()),
        }),
        source: "package",
        title: "Agent indexed",
      },
    ],
  },
  integration: {
    description:
      "The host must provide canonical descriptors, a non-exportable signing identity, hardened egress for remote discovery, and durable registry storage when indexing agents.",
    mode: "code-first",
  },
  settings: Type.Object({}),
  wiring: [],
});
