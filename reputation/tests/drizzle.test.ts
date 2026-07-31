import { PGlite } from "@electric-sql/pglite";
import { describe, expect, test } from "bun:test";
import { drizzle } from "drizzle-orm/pglite";
import { createDrizzleAgentReputationStore } from "../src/drizzle";

describe("Drizzle agent reputation store", () => {
  test("persists scoped evidence and revokes it once", async () => {
    const client = new PGlite();
    await client.exec(`
      CREATE TABLE agent_reputation_evidence (
        document jsonb NOT NULL,
        evidence_id text PRIMARY KEY,
        expires_at timestamptz,
        issued_at timestamptz NOT NULL,
        issuer text NOT NULL,
        revoked_at timestamptz,
        scope text NOT NULL,
        subject text NOT NULL
      )
    `);
    const store = createDrizzleAgentReputationStore({
      db: drizzle({ client }),
    });
    const evidence = {
      confidence: 0.9,
      evidenceId: "evidence-1",
      expiresAt: "2027-01-01T00:00:00.000Z",
      issuedAt: "2026-07-23T00:00:00.000Z",
      issuer: "did:web:certifier.example",
      kind: "conformance",
      recordedAt: "2026-07-23T00:01:00.000Z",
      scope: "website-builder",
      subject: "agent:builder-1",
      value: 0.8,
      verified: true,
    };

    await store.put(evidence);
    expect(await store.get(evidence.evidenceId)).toEqual(evidence);
    expect(await store.list(evidence.subject, evidence.scope)).toEqual([
      evidence,
    ]);

    const revokedAt = "2026-07-23T00:02:00.000Z";
    expect(await store.revoke(evidence.evidenceId, revokedAt)).toBe(true);
    expect(await store.revoke(evidence.evidenceId, revokedAt)).toBe(false);
    expect(await store.get(evidence.evidenceId)).toEqual({
      ...evidence,
      revokedAt,
    });
    await client.close();
  });
});
