import { defineManifest } from "@absolutejs/manifest";
import { Type } from "@sinclair/typebox";
export const manifest = defineManifest()({
  contract: 2,
  identity: {
    name: "@absolutejs/agent-memory",
    category: "data",
    tagline: "Give agents useful memory without giving memory authority.",
    description:
      "Scoped durable provenance-aware agent memory with per-operation authorization, retention, subject erasure, encrypted codecs, trust validation, and pluggable retrieval indexes.",
    docsUrl: "https://github.com/absolutejs/agent-memory",
    accent: "#8b5cf6",
  },
  settings: Type.Object({}),
  slots: {},
  implements: [],
  tools: {},
  wiring: [],
});
