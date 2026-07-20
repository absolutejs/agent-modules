import { addUsage, budgetExceeded } from "./budget";
import type { AgentRun, AgentRuntimeStore, AgentStep } from "./types";

const clone = <Value>(value: Value): Value => structuredClone(value);

export const createMemoryAgentRuntimeStore = (): AgentRuntimeStore => {
  const runs = new Map<string, AgentRun>();
  const steps = new Map<string, AgentStep[]>();
  const idempotency = new Set<string>();
  return {
    createRun: async (run) => {
      if (runs.has(run.id)) throw new Error("Run already exists");
      runs.set(run.id, clone(run));
      steps.set(run.id, []);
    },
    getRun: async (id) => clone(runs.get(id)),
    listRuns: async ({ limit = 50, status, tenantId, userId } = {}) =>
      [...runs.values()]
        .filter(
          (run) =>
            (!status || run.status === status) &&
            (!tenantId || run.actor.tenantId === tenantId) &&
            (!userId || run.actor.userId === userId),
        )
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
        .slice(0, Math.max(1, Math.min(limit, 200)))
        .map(clone),
    listSteps: async (runId) => clone(steps.get(runId) ?? []),
    claimDue: async ({ workerId, now, leaseExpiresAt }) => {
      const timestamp = Date.parse(now);
      const due = [...runs.values()]
        .filter(
          (run) =>
            (run.status === "queued" ||
              (run.status === "waiting" &&
                Date.parse(run.wakeAt ?? "") <= timestamp) ||
              (run.status === "running" &&
                Date.parse(run.leaseExpiresAt ?? "") <= timestamp)) &&
            run.cancelRequestedAt === undefined,
        )
        .sort((left, right) =>
          left.createdAt.localeCompare(right.createdAt),
        )[0];
      if (!due) return undefined;
      const next = {
        ...due,
        status: "running" as const,
        leaseOwner: workerId,
        leaseExpiresAt,
        wakeAt: undefined,
        version: due.version + 1,
        updatedAt: now,
      };
      runs.set(next.id, next);
      return clone(next);
    },
    heartbeat: async ({
      runId,
      workerId,
      expectedVersion,
      leaseExpiresAt,
      now,
    }) => {
      const run = runs.get(runId);
      if (
        !run ||
        run.version !== expectedVersion ||
        run.leaseOwner !== workerId ||
        run.status !== "running"
      )
        return undefined;
      const next = {
        ...run,
        leaseExpiresAt,
        version: run.version + 1,
        updatedAt: now,
      };
      runs.set(runId, next);
      return clone(next);
    },
    appendStep: async ({ runId, workerId, expectedVersion, step, now }) => {
      const run = runs.get(runId);
      if (
        !run ||
        run.version !== expectedVersion ||
        run.leaseOwner !== workerId ||
        run.status !== "running"
      )
        return undefined;
      const key = step.idempotencyKey
        ? `${runId}:${step.idempotencyKey}:${step.kind}`
        : undefined;
      if (key && idempotency.has(key)) return clone(run);
      const exceeded = budgetExceeded(run.budget, run.usage, step.usage);
      if (exceeded) throw new Error(`Agent budget exceeded: ${exceeded}`);
      const list = steps.get(runId) ?? [];
      if (step.sequence !== list.length + 1) return undefined;
      list.push(clone(step));
      if (key) idempotency.add(key);
      const next = {
        ...run,
        usage: addUsage(run.usage, step.usage),
        version: run.version + 1,
        updatedAt: now,
      };
      runs.set(runId, next);
      return clone(next);
    },
    transition: async ({
      runId,
      workerId,
      expectedVersion,
      status,
      now,
      output,
      checkpoint,
      wakeAt,
      error,
    }) => {
      const run = runs.get(runId);
      if (
        !run ||
        run.version !== expectedVersion ||
        (workerId && run.leaseOwner !== workerId)
      )
        return undefined;
      const next: AgentRun = {
        ...run,
        status,
        version: run.version + 1,
        updatedAt: now,
        ...(output === undefined ? {} : { output }),
        ...(checkpoint === undefined ? {} : { checkpoint }),
        ...(wakeAt === undefined ? {} : { wakeAt }),
        ...(error === undefined ? {} : { error }),
        ...(status === "running"
          ? {}
          : { leaseOwner: undefined, leaseExpiresAt: undefined }),
      };
      runs.set(runId, next);
      return clone(next);
    },
    requestCancel: async ({ runId, now }) => {
      const run = runs.get(runId);
      if (!run) return undefined;
      const terminal = [
        "completed",
        "failed",
        "cancelled",
        "handed_off",
      ].includes(run.status);
      if (terminal) return clone(run);
      const canCancelImmediately = run.status !== "running";
      const next: AgentRun = {
        ...run,
        status: canCancelImmediately ? "cancelled" : run.status,
        cancelRequestedAt: now,
        version: run.version + 1,
        updatedAt: now,
        ...(canCancelImmediately
          ? {
              leaseOwner: undefined,
              leaseExpiresAt: undefined,
              wakeAt: undefined,
            }
          : {}),
      };
      runs.set(runId, next);
      return clone(next);
    },
  };
};
