import { describe, expect, test } from "bun:test";
import {
  createAgentSandbox,
  createFetchAgentSandboxAdapter,
  createMemoryAgentSandboxOperationStore,
} from "../src";

const grant = {
  id: "grant-1",
  runId: "run-1",
  actor: { tenantId: "tenant-1", userId: "user-1", agentId: "agent-1" },
  agent: {
    descriptorId: "https://agent.example",
    descriptorVersion: "1",
    descriptorDigest: "sha256:abc",
  },
  issuedAt: "2026-07-15T00:00:00.000Z",
  expiresAt: "2026-07-16T00:00:00.000Z",
  issuer: "https://auth.example",
  capabilities: [
    {
      id: "api",
      kind: "http" as const,
      origins: ["https://api.example.com"],
      methods: ["POST"],
      pathPrefixes: ["/v1/messages"],
      credentialBindings: { authorization: ["service-token"] },
      maxUses: 1,
    },
  ],
};

describe("agent sandbox", () => {
  test("injects credentials internally and replays an idempotent result once", async () => {
    let calls = 0;
    const adapter = createFetchAgentSandboxAdapter({
      fetch: async (_url, init) => {
        calls += 1;
        expect(new Headers(init?.headers).get("authorization")).toBe(
          "Bearer secret",
        );
        return new Response("ok");
      },
    });
    const sandbox = createAgentSandbox({
      store: createMemoryAgentSandboxOperationStore(),
      adapters: { http: adapter },
      verifyGrant: () => true,
      resolveCredential: async () => "Bearer secret",
      now: () => Date.parse("2026-07-15T12:00:00.000Z"),
      id: () => "receipt-1",
    });
    const action = {
      kind: "http" as const,
      capabilityId: "api",
      requestId: "request-1",
      url: "https://api.example.com/v1/messages",
      method: "POST",
      credentials: { authorization: "service-token" },
    };
    const first = await sandbox.execute({ grant, action });
    const second = await sandbox.execute({ grant, action });
    expect(first).toEqual(second);
    expect(calls).toBe(1);
  });

  test("denies origin, method, path, and exhausted use limits before execution", async () => {
    let calls = 0;
    const sandbox = createAgentSandbox({
      store: createMemoryAgentSandboxOperationStore(),
      adapters: {
        http: {
          execute: async () => {
            calls += 1;
          },
        },
      },
      verifyGrant: () => true,
      resolveCredential: async () => "secret",
      now: () => Date.parse("2026-07-15T12:00:00.000Z"),
    });
    await expect(
      sandbox.execute({
        grant,
        action: {
          kind: "http",
          capabilityId: "api",
          requestId: "bad",
          url: "https://evil.example/v1/messages",
          method: "POST",
        },
      }),
    ).rejects.toThrow("origin");
    await sandbox.execute({
      grant,
      action: {
        kind: "http",
        capabilityId: "api",
        requestId: "good",
        url: "https://api.example.com/v1/messages",
        method: "POST",
      },
    });
    await expect(
      sandbox.execute({
        grant,
        action: {
          kind: "http",
          capabilityId: "api",
          requestId: "second",
          url: "https://api.example.com/v1/messages",
          method: "POST",
        },
      }),
    ).rejects.toThrow("limit");
    expect(calls).toBe(1);
  });

  test("binds credential aliases to exact safe destinations", async () => {
    const sandbox = createAgentSandbox({
      store: createMemoryAgentSandboxOperationStore(),
      adapters: { http: { execute: async () => undefined } },
      verifyGrant: () => true,
      resolveCredential: async () => "secret",
      now: () => Date.parse("2026-07-15T12:00:00.000Z"),
    });
    await expect(
      sandbox.execute({
        grant,
        action: {
          kind: "http",
          capabilityId: "api",
          requestId: "host-injection",
          url: "https://api.example.com/v1/messages",
          method: "POST",
          credentials: { host: "service-token" },
        },
      }),
    ).rejects.toThrow("target header is denied");
    await expect(
      sandbox.execute({
        grant,
        action: {
          kind: "http",
          capabilityId: "api",
          requestId: "cookie-injection",
          url: "https://api.example.com/v1/messages",
          method: "POST",
          credentials: { "x-api-key": "service-token" },
        },
      }),
    ).rejects.toThrow("binding is not granted");
  });

  test("does not replay an ambiguous adapter failure", async () => {
    let calls = 0;
    const sandbox = createAgentSandbox({
      store: createMemoryAgentSandboxOperationStore(),
      adapters: {
        http: {
          execute: async () => {
            calls += 1;
            throw new Error("connection lost after send");
          },
        },
      },
      verifyGrant: () => true,
      resolveCredential: async () => "secret",
      now: () => Date.parse("2026-07-15T12:00:00.000Z"),
    });
    const action = {
      kind: "http" as const,
      capabilityId: "api",
      requestId: "ambiguous",
      url: "https://api.example.com/v1/messages",
      method: "POST",
    };
    await expect(sandbox.execute({ grant, action })).rejects.toThrow(
      "connection lost",
    );
    await expect(sandbox.execute({ grant, action })).rejects.toThrow(
      "already in progress",
    );
    expect(calls).toBe(1);
  });
});
