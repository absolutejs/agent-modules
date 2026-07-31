import { canonicalJson } from "./canonical";
import type {
  AgentDiscoveryDocument,
  SignedAgentDiscoveryDocument,
} from "./types";
import { interfaceOf } from "./validation";

const escapeXml = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

export const toA2AAgentCard = (document: AgentDiscoveryDocument) => {
  const a2a = interfaceOf(document, "a2a");
  if (!a2a) return undefined;
  return {
    name: document.name,
    description: document.description,
    version: document.version,
    supportedInterfaces: [
      {
        url: a2a.url,
        protocolBinding: "JSONRPC",
        protocolVersion: a2a.protocolVersion ?? "1.0",
      },
    ],
    capabilities: { streaming: false, pushNotifications: false },
    defaultInputModes: ["application/json", "text/plain"],
    defaultOutputModes: ["application/json", "text/plain"],
    skills: document.capabilities.map((capability) => ({
      id: capability.id,
      name: capability.title,
      description: capability.description,
      tags: [...(capability.tags ?? [])],
      examples: document.examples
        ?.filter(
          (example) =>
            !example.capabilityId || example.capabilityId === capability.id,
        )
        .map(({ prompt }) => prompt),
    })),
  };
};

export const toJsonLd = (document: AgentDiscoveryDocument) => ({
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  "@id": document.id,
  name: document.name,
  description: document.description,
  applicationCategory: "AI Agent",
  softwareVersion: document.version,
  url: document.url,
  publisher: {
    "@type": "Organization",
    name: document.publisher.name,
    url: document.publisher.url,
  },
  featureList: document.capabilities.map(({ title }) => title),
  inLanguage: document.languages,
});

export const agentsText = (documents: readonly AgentDiscoveryDocument[]) =>
  [
    "# AI Agents",
    "",
    "Machine-readable descriptors:",
    ...documents.flatMap((document) => [
      "",
      `## ${document.name}`,
      document.description,
      `Descriptor: ${new URL(document.id).toString()}`,
      ...document.interfaces.map(
        (entry) => `${entry.type.toUpperCase()}: ${entry.url}`,
      ),
      `Capabilities: ${document.capabilities.map(({ id }) => id).join(", ")}`,
    ]),
    "",
  ].join("\n");

export const agentSitemap = (documents: readonly AgentDiscoveryDocument[]) =>
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${documents
    .map(
      (document) =>
        `\n  <url><loc>${escapeXml(document.id)}</loc><lastmod>${escapeXml(document.updatedAt)}</lastmod></url>`,
    )
    .join("")}\n</urlset>\n`;

export const discoveryIndex = (
  documents: readonly SignedAgentDiscoveryDocument[],
) => ({
  schema: "https://absolutejs.com/schemas/agent-discovery-index/v1",
  agents: documents.map(({ document, signatures }) => ({
    id: document.id,
    name: document.name,
    description: document.description,
    updatedAt: document.updatedAt,
    signatures,
  })),
});

export const json = (value: unknown) => canonicalJson(value);
