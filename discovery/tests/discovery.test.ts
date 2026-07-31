import { describe, expect, test } from "bun:test";
import {
  ABSOLUTE_AGENT_PATH,
  ABSOLUTE_AGENT_SCHEMA,
  createAgentDiscoveryHandler,
  createAgentRegistry,
  createAgentRegistryHandler,
  createMemoryAgentRegistry,
  fetchAgentDocument,
  signAgentDocument,
  toA2AAgentCard,
  verifyAgentDocument,
  type AgentDiscoveryDocument,
} from "../src";

const key = new TextEncoder().encode("test-discovery-key");
const signer = {
  algorithm: "HS256",
  keyId: "https://agents.example/keys/1",
  sign: async (payload: Uint8Array) =>
    new Uint8Array(
      await crypto.subtle.sign(
        "HMAC",
        await crypto.subtle.importKey(
          "raw",
          key,
          { name: "HMAC", hash: "SHA-256" },
          false,
          ["sign"],
        ),
        payload,
      ),
    ),
};
const verifier = {
  verify: async ({
    payload,
    signature,
  }: {
    payload: Uint8Array;
    signature: Uint8Array;
  }) =>
    crypto.subtle.verify(
      "HMAC",
      await crypto.subtle.importKey(
        "raw",
        key,
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["verify"],
      ),
      signature,
      payload,
    ),
};
const document: AgentDiscoveryDocument = {
  $schema: ABSOLUTE_AGENT_SCHEMA,
  id: "https://agents.example/.well-known/absolute-agent.json",
  name: "Travel Planner",
  description: "Finds and books policy-compliant travel.",
  version: "1.0.0",
  url: "https://agents.example/travel",
  publisher: {
    id: "https://example.com",
    name: "Example",
    jwksUri: "https://example.com/.well-known/jwks.json",
  },
  capabilities: [
    {
      id: "travel.search",
      title: "Search travel",
      description: "Search flights and hotels",
      tags: ["travel", "flights"],
      effects: ["read"],
    },
  ],
  interfaces: [
    { type: "a2a", url: "https://agents.example/a2a", protocolVersion: "1.0" },
    {
      type: "mcp",
      url: "https://agents.example/mcp",
      protocolVersion: "2025-11-25",
    },
    {
      type: "arazzo",
      url: "https://agents.example/arazzo.yaml",
      protocolVersion: "1.1.0",
    },
    {
      type: "webmcp",
      url: "https://agents.example/app",
      protocolVersion: "2026-07-draft",
    },
  ],
  authentication: {
    schemes: ["oauth2"],
    protectedResourceMetadata:
      "https://agents.example/.well-known/oauth-protected-resource",
  },
  categories: ["travel"],
  tags: ["booking"],
  languages: ["en"],
  paymentProtocols: ["ap2"],
  createdAt: "2026-07-15T00:00:00.000Z",
  updatedAt: "2026-07-15T00:00:00.000Z",
};

describe("agent discovery", () => {
  test("signs, verifies, and detects tampering", async () => {
    const signed = await signAgentDocument(document, signer);
    expect((await verifyAgentDocument(signed, verifier)).ok).toBe(true);
    const tampered = {
      ...signed,
      document: { ...signed.document, name: "Impostor" },
    };
    expect((await verifyAgentDocument(tampered, verifier)).ok).toBe(false);
  });

  test("projects A2A and serves cacheable discovery", async () => {
    const signed = await signAgentDocument(document, signer);
    expect(toA2AAgentCard(document)?.skills[0]?.id).toBe("travel.search");
    const response = await createAgentDiscoveryHandler({ documents: [signed] })(
      new Request(`https://agents.example${ABSOLUTE_AGENT_PATH}`),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("etag")).toBeTruthy();
    expect((await response.json()).document.id).toBe(document.id);
  });

  test("ranks verified capability matches", async () => {
    const signed = await signAgentDocument(document, signer);
    const registry = createAgentRegistry({
      store: createMemoryAgentRegistry(),
      verifier,
    });
    await registry.publish(signed);
    const result = await registry.search({
      text: "travel flights",
      verifiedOnly: true,
    });
    expect(result.results).toHaveLength(1);
    expect(result.results[0]?.verified).toBe(true);
    expect(result.results[0]?.matched).toContain("capability");
  });

  test("exposes searchable registry metadata and denies anonymous publishing by default", async () => {
    const signed = await signAgentDocument(document, signer);
    const registry = createAgentRegistry({
      store: createMemoryAgentRegistry(),
      verifier,
    });
    await registry.publish(signed);
    const handler = createAgentRegistryHandler({
      registry,
      metadata: {
        name: "Absolute Agent Registry",
        description: "Verified agents",
        searchEndpoint: "https://registry.example/v1/agents",
        submissionEndpoint: "https://registry.example/v1/agents",
        requiresVerifiedSignatures: true,
      },
    });
    const result = await handler(
      new Request("https://registry.example/v1/agents?q=flights"),
    );
    expect(result.status).toBe(200);
    expect((await result.json()).results[0].agent.id).toBe(document.id);
    const denied = await handler(
      new Request("https://registry.example/v1/agents", {
        method: "POST",
        body: JSON.stringify(signed),
      }),
    );
    expect(denied.status).toBe(403);
  });

  test("uses a live schema and rejects credential URLs and oversized metadata", async () => {
    expect(ABSOLUTE_AGENT_SCHEMA).toBe(
      "https://absolutejs.github.io/agents/schemas/agent-discovery/v1.json",
    );
    await expect(
      signAgentDocument(
        {
          ...document,
          publisher: {
            ...document.publisher,
            jwksUri: "https://user:secret@example.com/jwks.json",
          },
        },
        signer,
      ),
    ).rejects.toThrow("without credentials");
    await expect(
      signAgentDocument(
        { ...document, description: "x".repeat(10_001) },
        signer,
      ),
    ).rejects.toThrow("description is invalid");
  });

  test("hardens remote discovery transport and parses the signed envelope", async () => {
    const signed = await signAgentDocument(document, signer);
    const fetcher = async () =>
      new Response(JSON.stringify(signed), {
        headers: { "content-type": "application/json" },
      });
    expect(
      (await fetchAgentDocument({ fetch: fetcher, url: document.id })).document
        .id,
    ).toBe(document.id);
    await expect(
      fetchAgentDocument({
        fetch: fetcher,
        url: "https://user:secret@agents.example/agent.json",
      }),
    ).rejects.toThrow("without credentials");
    await expect(
      fetchAgentDocument({
        fetch: async () =>
          new Response("<html>", {
            headers: { "content-type": "text/html" },
          }),
        url: document.id,
      }),
    ).rejects.toThrow("not JSON");
  });
});
