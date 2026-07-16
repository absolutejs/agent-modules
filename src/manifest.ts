import { defineManifest } from "@absolutejs/manifest";
import { Type } from "@sinclair/typebox";

export const manifest = defineManifest<Record<string, never>>()({
  contract: 2,
  identity: {
    accent: "#f97316",
    category: "ai",
    description:
      "Durable provider-neutral AI agent orchestration with leased runs, atomic steps, hard budgets, checkpoints, timers, cancellation, idempotent effects, and discovery-pinned handoffs.",
    docsUrl: "https://github.com/absolutejs/agent-runtime",
    name: "@absolutejs/agent-runtime",
    tagline: "Run agents durably without choosing their model provider.",
  },
  settings: Type.Object({}),
  wiring: [],
});
