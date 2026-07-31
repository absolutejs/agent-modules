import { describe, expect, test } from "bun:test";
import {
  AGENT_REPUTATION_CONTEXT,
  agentReputationPostgresSchemaSql,
  createAgentReputation,
  createAgentReputationCredential,
  createMemoryAgentReputationStore,
  verifyAgentReputationCredential,
} from "../src";

const subject = "https://agents.example/calendar";
const issuer = "did:web:certifier.example";
const base = {
  confidence: 1,
  issuedAt: "2026-07-15T00:00:00.000Z",
  issuer,
  kind: "conformance" as const,
  scope: "calendar.scheduling",
  subject,
  value: 1,
};

describe("agent reputation", () => {
  test("requires verified evidence and computes a scoped decayed assessment", async () => {
    const now = Date.parse("2026-07-16T00:00:00.000Z");
    const reputation = createAgentReputation({
      halfLifeMs: 24 * 60 * 60 * 1_000,
      now: () => now,
      store: createMemoryAgentReputationStore(),
      verifyEvidence: (evidence) =>
        evidence.receiptDigest?.startsWith("sha256:") === true,
    });
    await expect(
      reputation.record({
        ...base,
        evidenceId: "bad",
        receiptDigest: "unverified",
      }),
    ).rejects.toThrow("cryptographically verified");
    await reputation.record({
      ...base,
      evidenceId: "good",
      receiptDigest: "sha256:good",
    });
    const assessment = await reputation.assess(subject, "calendar.scheduling");
    expect(assessment).toMatchObject({
      evidenceCount: 1,
      issuerCount: 1,
      scope: "calendar.scheduling",
      subject,
    });
    expect(assessment.score).toBeGreaterThan(50);
    expect((await reputation.assess(subject, "payments")).score).toBe(50);
    expect(await reputation.revoke("good")).toBeTrue();
    expect(
      (await reputation.assess(subject, "calendar.scheduling")).score,
    ).toBe(50);
  });

  test("caps repeated evidence per issuer and weights independent issuers", async () => {
    const store = createMemoryAgentReputationStore();
    const reputation = createAgentReputation({
      maxEvidencePerIssuer: 1,
      now: () => Date.parse("2026-07-16T00:00:00.000Z"),
      store,
      verifyEvidence: () => true,
    });
    await reputation.record({ ...base, evidenceId: "one" });
    await reputation.record({
      ...base,
      evidenceId: "two",
      issuedAt: "2026-07-15T01:00:00.000Z",
    });
    await reputation.record({
      ...base,
      evidenceId: "negative",
      issuer: "did:web:security.example",
      kind: "security-incident",
      value: -1,
    });
    const result = await reputation.assess(subject, base.scope);
    expect(result.evidenceCount).toBe(2);
    expect(result.issuerCount).toBe(2);
    expect(result.score).toBeCloseTo(50, 0);
  });

  test("creates and verifies a VC 2.0 reputation credential through adapters", async () => {
    const assessment = {
      confidence: 0.5,
      evidenceCount: 2,
      generatedAt: "2026-07-16T00:00:00.000Z",
      issuerCount: 2,
      negativeWeight: 0.5,
      positiveWeight: 1,
      score: 60,
      scope: base.scope,
      subject,
    };
    const credential = createAgentReputationCredential({ assessment, issuer });
    expect(credential["@context"]).toEqual([
      "https://www.w3.org/ns/credentials/v2",
      AGENT_REPUTATION_CONTEXT,
    ]);
    expect(
      await verifyAgentReputationCredential({ credential }, (secured) =>
        Promise.resolve(
          (secured as { credential: typeof credential }).credential,
        ),
      ),
    ).toEqual(credential);
  });

  test("ships indexed durable PostgreSQL storage", () => {
    const sql = agentReputationPostgresSchemaSql();
    expect(sql).toContain("PRIMARY KEY");
    expect(sql).toContain("subject,scope,issued_at DESC");
    expect(() => agentReputationPostgresSchemaSql("bad-name")).toThrow(
      "Invalid PostgreSQL schema",
    );
  });
});
