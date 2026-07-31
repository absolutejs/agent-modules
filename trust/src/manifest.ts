import { defineManifest } from "@absolutejs/manifest";
import { Type } from "@sinclair/typebox";
export const manifest = defineManifest()({
  contract: 2,
  discovery: {
    audiences: ["agent-hosts", "security-teams"],
    intents: [
      "track agent context provenance",
      "prevent prompt injection",
      "guard agent sinks",
    ],
    keywords: [
      "agents",
      "provenance",
      "taint",
      "prompt-injection",
      "guarded-sinks",
    ],
    protocols: ["AbsoluteJS Agent Trust"],
  },
  identity: {
    name: "@absolutejs/agent-trust",
    category: "security",
    tagline:
      "Keep agent instructions authoritative and external data untrusted.",
    description:
      "Provider-neutral provenance envelopes, taint propagation, explicit instruction/data channels, evidence-bearing sanitizers, and fail-closed sink policies for AI agents.",
    docsUrl: "https://github.com/absolutejs/agent-modules/tree/main/trust",
    accent: "#f59e0b",
  },
  integration: {
    description:
      "The host must define trusted instruction sources, taint propagation, sanitizers, and fail-closed sink policies for its own data and effect boundaries.",
    mode: "code-first",
  },
  settings: Type.Object({}),
  wiring: [],
});
