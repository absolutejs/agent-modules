import { defineManifest } from "@absolutejs/manifest";
import { Type } from "@sinclair/typebox";

export const manifest = defineManifest<Record<string, never>>()({
  contract: 2,
  discovery: {
    audiences: ["agent-hosts", "platform-operators"],
    intents: [
      "run agents durably",
      "recover agent work",
      "enforce agent budgets",
    ],
    keywords: [
      "agents",
      "orchestration",
      "durability",
      "budgets",
      "checkpoints",
    ],
    protocols: ["AbsoluteJS Agent Runtime"],
  },
  identity: {
    accent: "#f97316",
    category: "ai",
    description:
      "Durable provider-neutral AI agent orchestration with leased runs, atomic steps, hard budgets, checkpoints, timers, cancellation, idempotent effects, and discovery-pinned handoffs.",
    docsUrl: "https://github.com/absolutejs/agent-modules/tree/main/runtime",
    name: "@absolutejs/agent-runtime",
    tagline: "Run agents durably without choosing their model provider.",
  },
  integration: {
    description:
      "The host must supply a transactional runtime store, model driver, idempotent effect executor, migrations, workers, and production readiness checks.",
    mode: "code-first",
  },
  settings: Type.Object({}),
  wiring: [],
});
