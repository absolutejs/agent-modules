import { defineManifest } from "@absolutejs/manifest";
import { Type } from "@sinclair/typebox";
export const manifest = defineManifest<Record<string, never>>()({
  contract: 2,
  discovery: {
    audiences: ["platform-operators", "security-teams"],
    intents: [
      "inspect agent activity",
      "revoke agent access",
      "operate an agent kill switch",
    ],
    keywords: [
      "agents",
      "operations",
      "approvals",
      "revocation",
      "kill-switch",
      "console",
    ],
    protocols: ["AbsoluteJS Agent Control"],
  },
  identity: {
    accent: "#dc2626",
    category: "security",
    description:
      "Authenticated operator API, CSP-hardened console, and bound plan-then-execute playground for approvals, runs, budgets, delegations, memory metadata, reputation, durable kill switches, and leased idempotent operations.",
    docsUrl: "https://github.com/absolutejs/agent-control",
    name: "@absolutejs/agent-control",
    tagline: "See and stop every capability an agent holds.",
  },
  integration: {
    description:
      "The host must bind authenticated operators, exact scopes, durable operation and playground stores, Agency state, kill switches, and auditable execution adapters.",
    mode: "code-first",
  },
  settings: Type.Object({}),
  wiring: [],
});
