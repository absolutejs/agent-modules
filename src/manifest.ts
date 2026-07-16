import { defineManifest } from "@absolutejs/manifest";
import { Type } from "@sinclair/typebox";
export const manifest = defineManifest()({
  contract: 2,
  identity: {
    name: "@absolutejs/agent-trust",
    category: "security",
    tagline:
      "Keep agent instructions authoritative and external data untrusted.",
    description:
      "Provider-neutral provenance envelopes, taint propagation, explicit instruction/data channels, evidence-bearing sanitizers, and fail-closed sink policies for AI agents.",
    docsUrl: "https://github.com/absolutejs/agent-trust",
    accent: "#f59e0b",
  },
  settings: Type.Object({}),
  slots: {},
  implements: [],
  tools: {},
  wiring: [],
});
