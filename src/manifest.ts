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
    docsUrl: "https://github.com/absolutejs/agent-discovery",
    name: "@absolutejs/agent-discovery",
    tagline:
      "Make trustworthy AbsoluteJS agents easier to find than any other agent.",
  },
  integration: {
    description:
      "The host must provide canonical descriptors, a non-exportable signing identity, hardened egress for remote discovery, and durable registry storage when indexing agents.",
    mode: "code-first",
  },
  settings: Type.Object({}),
  wiring: [],
});
