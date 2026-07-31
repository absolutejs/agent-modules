import { defineManifest } from "@absolutejs/manifest";
import { Type } from "@sinclair/typebox";
export const manifest = defineManifest()({
  contract: 2,
  discovery: {
    audiences: ["agent-hosts", "application-developers"],
    intents: [
      "store agent memory",
      "erase agent memory",
      "authorize agent recall",
    ],
    keywords: [
      "agents",
      "memory",
      "retention",
      "erasure",
      "provenance",
      "retrieval",
    ],
    protocols: ["AbsoluteJS Agent Memory"],
  },
  identity: {
    name: "@absolutejs/agent-memory",
    category: "data",
    tagline: "Give agents useful memory without giving memory authority.",
    description:
      "Scoped durable provenance-aware agent memory with per-operation authorization, retention, subject erasure, encrypted codecs, trust validation, and pluggable retrieval indexes.",
    docsUrl: "https://github.com/absolutejs/agent-modules/tree/main/memory",
    accent: "#8b5cf6",
  },
  integration: {
    description:
      "The host must supply scoped authorization, durable storage, encryption, retention, erasure, provenance policy, and any retrieval index.",
    mode: "code-first",
  },
  settings: Type.Object({}),
  wiring: [],
});
