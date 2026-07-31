# @absolutejs/agent-control

Authenticated web-standard operator API over `@absolutejs/agency`'s control
plane. It inventories every registered source, activates the durable kill switch
before cleanup, reports partial source failures, restores deliberately, and uses
leased idempotency records so operator retries cannot change the requested input.

Agency is a required host peer (`>=0.7.1 <0.8.0`), not a bundled dependency.
The operator surface must inspect and decide against the host's one durable
Agency ledger. This package tests against exactly `0.7.1`; a new Agency minor
requires an explicit compatibility release.

Scopes are `agents:read`, `agents:revoke`, and `agents:restore`. Mutations require
an `operationId`, bounded `reason`, same-origin `Origin` header, and
`X-Agent-Control-Intent: mutate`; PostgreSQL operations can be safely reclaimed
after a crashed operator process's lease expires.

`createAgentControlConsoleHandler()` adds a dependency-free authenticated
operator console to the same package. Its snapshot shows agent status, pending
approvals, durable runs and budgets, delegation scope and expiry, memory
metadata, and scope-specific reputation without exposing memory contents or raw
action inputs. Approval decisions require `agents:approve`, same-origin
requests, an explicit mutation-intent header, a reason, and an idempotency key.

```ts
const console = createAgentControlConsoleHandler({
  authorize: verifyOperator,
  operations: createPostgresOperationStore({ client }),
  data: {
    snapshot: (operator) => loadSafeOperatorSnapshot(operator),
    decideApproval: (decision) => applyAgencyDecision(decision),
  },
});
```

The HTML console uses a per-response Content Security Policy nonce, constructs
all remote data with DOM `textContent`, cannot be framed, stores no cache, and
has no third-party assets. The data adapter keeps it provider-neutral and lets
applications compose `@absolutejs/agency`, `agent-runtime`, `agent-memory`, and
`agent-reputation` without creating hard dependencies.

The PostgreSQL operation store accepts readonly query results, so the same
small Bun SQL adapter can be shared with Agency without copying result rows.

`createAgentPlaygroundHandler()` adds a provider-neutral plan-then-execute UI
and API. Planning is a separate, explicitly effect-free adapter operation. The
server stores the full input and only returns its digest, expires plans quickly,
binds them to the operator, refuses denied or approval-pending plans, and uses
the same leased idempotency store for execution. The browser cannot mutate a
plan between review and execution.
