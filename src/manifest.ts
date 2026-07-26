import { defineManifest } from "@absolutejs/manifest";
import { Type } from "@sinclair/typebox";

export const manifest = defineManifest()({
  contract: 2,
  discovery: {
    audiences: ["agent-hosts", "security-teams"],
    intents: [
      "sandbox agent actions",
      "restrict agent network access",
      "restrict agent processes",
    ],
    keywords: [
      "agents",
      "sandbox",
      "capabilities",
      "http",
      "filesystem",
      "process",
    ],
    protocols: ["AbsoluteJS Agent Capabilities"],
  },
  identity: {
    name: "@absolutejs/agent-sandbox",
    category: "security",
    tagline: "Give agents narrow capabilities, never ambient authority.",
    description:
      "Deny-by-default, expiring capability grants and idempotent provider-neutral action adapters for HTTP, filesystem, process, and credential-safe agent actions.",
    docsUrl: "https://github.com/absolutejs/agent-sandbox",
    accent: "#ef4444",
  },
  integration: {
    description:
      "The host must issue narrow expiring grants and bind only the HTTP, filesystem, process, and credential adapters its isolation boundary can enforce.",
    mode: "code-first",
  },
  settings: Type.Object({}),
  wiring: [],
});
