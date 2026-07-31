# @absolutejs/agent-reputation

Portable, evidence-based reputation for AI agents without a gameable universal
trust score.

Reputation is always assessed for an explicit scope. Evidence has a stable
subject and issuer, bounded value and confidence, issuance and expiration,
optional receipt digest, verification status, and revocation state. Assessment
uses a neutral Bayesian prior, time decay, configurable issuer trust, and a cap
per issuer so one party cannot inflate a score by repeating claims.

```ts
import { createAgentReputation } from "@absolutejs/agent-reputation";
import {
  agentReputationDrizzleSchema,
  createDrizzleAgentReputationStore,
} from "@absolutejs/agent-reputation/drizzle";

const reputation = createAgentReputation({
  store: createDrizzleAgentReputationStore({ db }),
  verifyEvidence: (evidence) => verifyIssuerReceipt(evidence),
  issuerWeights: { "did:web:certifier.example": 1 },
});

await reputation.record(signedConformanceEvidence);
const assessment = await reputation.assess(
  "https://agents.example/calendar",
  "calendar.scheduling",
);
```

Include `agentReputationDrizzleSchema` in the host's normal Drizzle migrations.
The package-owned RC4 store works with Postgres providers including Neon,
generates insert/select TypeBoxes, and uses a Bun-portable JSONB codec. The
structural SQL adapter remains available for compatibility.

Unsigned or unverifiable evidence is denied by default. `allowUnverified` is an
explicit local-development escape hatch. Revoked and expired evidence is never
scored, evidence from each issuer is capped, old evidence decays, and evidence
from one scope is never silently reused in another.

`createAgentReputationCredential()` maps an assessment to the W3C Verifiable
Credentials Data Model 2.0. Signing and verification remain adapters so callers
can use the W3C JOSE/COSE Recommendation, Data Integrity proofs, SD-JWT, a DID
stack, or an enterprise trust service without provider lock-in.
The package publishes a stable remote JSON-LD context at
<https://absolutejs.github.io/agents/contexts/reputation/v1.json>.

Standards:

- <https://www.w3.org/TR/vc-data-model-2.0/>
- <https://www.w3.org/TR/vc-jose-cose/>

## License

MIT
