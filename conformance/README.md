# @absolutejs/agent-conformance

Provider-neutral adversarial test runners for AI agent security boundaries.
Adapters expose a tiny harness; the package attacks it with replay, concurrent
maximum-use races, confused-deputy identity, scope escalation, lookalike URL
origins, mutated approved inputs, denied lease issuance, failed-execution
replay, and task-owner isolation.

```ts
import {
  assertConformance,
  runCapabilityConformance,
} from "@absolutejs/agent-conformance";

const report = await runCapabilityConformance(() => yourHarness());
assertConformance(report); // throws with the complete report when any case fails
```

The runners return data rather than depending on a test framework, so they work
inside Bun test, Vitest, Jest, CI scripts, or provider certification jobs.

The effect-adapter suites separately prove global certification,
descriptor-driven reconciliation setup, tenant-scoped installation, and
execution-time behavior. The execution suite verifies that
authorization happens before secret resolution, only installed aliases are
resolved, tenant/effect/destination/idempotency context reaches the driver,
driver capabilities match the certified descriptor, and unknown provider
outcomes enter durable quarantine.

The effect-evidence suite verifies that provider signatures are checked before
persistence, duplicate deliveries remain single-copy while reconciliation can
resume after a crash, retained delivery identities cannot be rebound across
effects or tenants, and only normalized evidence crosses the durable boundary.

The reconciliation-runtime suite proves that scheduled provider queries
authorize before resolving credentials, use a cross-replica lease, retain only
normalized evidence, reduce failures to safe health codes, and keep an
operator-triggered tenant run from querying another tenant's effects. It also
proves that reference-gated queries stop before credential resolution when no
exact provider resource is retained and that stale attempts cannot quarantine
a newer lease.

Version 0.3 adds discovery signature/search, durable runtime recovery/budget,
provenance/taint, scoped memory, and verified inbox suites. Passing reports can
be combined into a deterministic, optionally signed
`absolutejs-agent-first-1` certification artifact and linked from an agent's
public discovery descriptor.

Version 0.4 adds provider-neutral conformance harnesses for A2A 1.0, MCP
2025-11-25, Arazzo 1.1, and the July 2026 WebMCP draft. They test protocol
negotiation, task/session isolation, required extensions, unsafe callback URLs,
dependency ordering, policy-before-effect, unsupported-feature atomicity,
input validation, metadata poisoning, cross-origin exposure, and abort cleanup.

```ts
import {
  runA2aConformance,
  runArazzoConformance,
  runMcpConformance,
  runWebMcpConformance,
} from "@absolutejs/agent-conformance";
```

Implement only the harnesses relevant to your package:

- `ActionConformanceHarness` for approval binding and execution leases.
- `CapabilityConformanceHarness` for credential grants, delegations, spend
  mandates, or other bounded capabilities.
- `TaskConformanceHarness` for durable task ownership and cancellation.

## Rejections must name their control

Every scenario that expects a rejection asserts on a token from the control's
own vocabulary — `"lease"`, `"owner"`, `"private"`, `"host"`, `"replay"`,
`"denied"`, `"bound"`, `"scope"`, `"actor"`, `"destination"`. Your
implementation's error message has to contain it.

This is a real obligation, and it exists because the alternative is worse. A
scenario that accepts _any_ rejection passes on failures that have nothing to
do with the control it claims to test:

```
fetch("https://api.example.com.evil.test")
  -> "Unable to connect. Is the computer able to access the url?"
fetch("https://169.254.169.254/latest")
  -> "The operation timed out."
```

Both throw. Before 0.15.0 both satisfied the egress scenarios on any machine —
so a suite meant to prove SSRF and lookalike-origin defences proved nothing,
and reported a green tick while doing it. `.evil.test` is a reserved TLD that
can never resolve, which means that scenario could not have failed for the
right reason even in principle.

An unnamed rejection is indistinguishable from an accident. Naming the control
is what makes a pass mean something.

## License

MIT
