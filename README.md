# @absolutejs/agent-runtime

Durable, provider-neutral orchestration for AI agents. This package owns runs,
steps, leases, budgets, checkpoints, timers, cancellation, effects, and handoffs.
It does not choose a model, database driver, queue, or web framework.

Every run pins the exact signed discovery descriptor id, version, and digest that
was selected. A remote agent therefore cannot silently replace its advertised
capabilities during a workflow or handoff.

```ts
const runtime = createAgentRuntime({
  store: createPostgresAgentRuntimeStore({ client: sql }),
  driver: myModelAdapter,
  effects: executionAdapter,
});

await runtime.start({
  actor: { tenantId, userId, agentId, delegationId },
  agent: selectedDiscoveryIdentity,
  goal: "Rebook the delayed flight",
  input,
  budget: { actions: 8, costMicros: 50_000, spendMinor: 30_000 },
});
```

Workers claim due runs with `FOR UPDATE SKIP LOCKED`. Every append checks the
lease, optimistic version, sequence, idempotency key, and budget inside one
transaction. Effects are recorded as requested before execution and require a
stable idempotency key; use `@absolutejs/execution` as the executor for crash-safe
external effects and reconciliation.

PostgreSQL is the durable default. Apply `agentRuntimePostgresSchemaSql()` through
your migrations. Redis is not a run store or work queue.

Memory stores are development and test defaults only.
