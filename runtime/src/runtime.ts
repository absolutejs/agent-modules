import { normalizeUsage, remainingBudget, zeroUsage } from "./budget";
import { AgentEffectDeferredError } from "./types";
import type {
  AgentDriver,
  AgentEffectExecutor,
  AgentRun,
  AgentRunEvent,
  AgentRuntime,
  AgentRuntimeStore,
  AgentStep,
  AgentTransition,
} from "./types";

const makeId = () => crypto.randomUUID();

export const createAgentRuntime = ({
  store,
  driver,
  effects,
  now = Date.now,
  id = makeId,
  leaseMs = 30_000,
  maxStepsPerClaim = 25,
  onEvent,
}: {
  store: AgentRuntimeStore;
  driver: AgentDriver;
  effects: AgentEffectExecutor;
  now?: () => number;
  id?: () => string;
  leaseMs?: number;
  maxStepsPerClaim?: number;
  onEvent?: (event: AgentRunEvent) => void | Promise<void>;
}): AgentRuntime => {
  const emit = async (event: AgentRunEvent) => {
    await onEvent?.(event);
  };
  const transition = async (
    run: AgentRun,
    workerId: string,
    change: Omit<
      Parameters<AgentRuntimeStore["transition"]>[0],
      "runId" | "workerId" | "expectedVersion" | "now"
    >,
  ) => {
    const updated = await store.transition({
      runId: run.id,
      workerId,
      expectedVersion: run.version,
      now: new Date(now()).toISOString(),
      ...change,
    });
    if (!updated) throw new Error("Agent run lease or version was lost");
    await emit({ type: "run.transitioned", run: updated });
    return updated;
  };
  const append = async (
    run: AgentRun,
    workerId: string,
    value: Omit<
      AgentStep,
      "id" | "runId" | "sequence" | "createdAt" | "usage"
    > & { usage?: Parameters<typeof normalizeUsage>[0] },
  ) => {
    const steps = await store.listSteps(run.id);
    const step: AgentStep = {
      ...value,
      id: id(),
      runId: run.id,
      sequence: steps.length + 1,
      createdAt: new Date(now()).toISOString(),
      usage: normalizeUsage(value.usage),
    };
    const updated = await store.appendStep({
      runId: run.id,
      workerId,
      expectedVersion: run.version,
      step,
      now: step.createdAt,
    });
    if (!updated)
      throw new Error("Agent run lease, sequence, or version was lost");
    await emit({ type: "step.appended", run: updated, step });
    return { run: updated, step };
  };

  const handle = async (
    run: AgentRun,
    workerId: string,
    result: AgentTransition,
  ): Promise<AgentRun> => {
    if (result.type === "continue")
      return (
        await append(run, workerId, {
          kind: result.kind ?? "observation",
          name: result.name,
          input: result.input,
          output: result.output,
          usage: result.usage,
        })
      ).run;
    if (result.type === "effect") {
      const requested = await append(run, workerId, {
        kind: "effect.requested",
        name: result.name,
        input: result.input,
        idempotencyKey: result.idempotencyKey,
        usage: { ...result.usage, actions: (result.usage?.actions ?? 0) + 1 },
      });
      try {
        const output = await effects.execute({
          run: requested.run,
          step: requested.step,
          name: result.name,
          payload: result.input,
          idempotencyKey: result.idempotencyKey,
        });
        return (
          await append(requested.run, workerId, {
            kind: "effect.completed",
            name: result.name,
            output,
            idempotencyKey: result.idempotencyKey,
          })
        ).run;
      } catch (error) {
        if (error instanceof AgentEffectDeferredError) {
          if (!Number.isFinite(Date.parse(error.retryAt)))
            throw new Error("Invalid deferred effect retry timestamp");
          return transition(requested.run, workerId, {
            status: "waiting",
            wakeAt: error.retryAt,
          });
        }
        const failed = await append(requested.run, workerId, {
          kind: "effect.failed",
          name: result.name,
          output: {
            message: error instanceof Error ? error.message : "Effect failed",
          },
          idempotencyKey: result.idempotencyKey,
        });
        return transition(failed.run, workerId, {
          status: "failed",
          error: {
            code: "effect_failed",
            message: error instanceof Error ? error.message : "Effect failed",
            retryable: true,
          },
        });
      }
    }
    if (result.type === "checkpoint") {
      const checkpointed = await append(run, workerId, {
        kind: "checkpoint",
        output: { reason: result.reason, checkpoint: result.checkpoint },
      });
      return transition(checkpointed.run, workerId, {
        status: "suspended",
        checkpoint: result.checkpoint,
      });
    }
    if (result.type === "wait") {
      if (!Number.isFinite(Date.parse(result.until)))
        throw new Error("Invalid wait timestamp");
      const waiting = await append(run, workerId, {
        kind: "wait",
        output: { reason: result.reason, until: result.until },
      });
      return transition(waiting.run, workerId, {
        status: "waiting",
        wakeAt: result.until,
        checkpoint: result.checkpoint,
      });
    }
    if (result.type === "handoff") {
      const handed = await append(run, workerId, {
        kind: "handoff",
        output: {
          target: result.target,
          input: result.input,
          reason: result.reason,
        },
      });
      return transition(handed.run, workerId, {
        status: "handed_off",
        output: {
          target: result.target,
          input: result.input,
          reason: result.reason,
        },
      });
    }
    if (result.type === "complete") {
      const completed = await append(run, workerId, {
        kind: "completed",
        output: result.output,
      });
      return transition(completed.run, workerId, {
        status: "completed",
        output: result.output,
      });
    }
    const failed = await append(run, workerId, {
      kind: "failed",
      output: { code: result.code, message: result.message },
    });
    return transition(failed.run, workerId, {
      status: "failed",
      error: {
        code: result.code,
        message: result.message,
        retryable: result.retryable ?? false,
      },
    });
  };

  const resumePendingEffect = async (
    run: AgentRun,
    workerId: string,
    steps: readonly AgentStep[],
  ): Promise<AgentRun | undefined> => {
    const requested = steps.at(-1);
    if (
      requested?.kind !== "effect.requested" ||
      !requested.name ||
      !requested.idempotencyKey
    )
      return undefined;
    try {
      const output = await effects.execute({
        run,
        step: requested,
        name: requested.name,
        payload: requested.input,
        idempotencyKey: requested.idempotencyKey,
      });
      return (
        await append(run, workerId, {
          kind: "effect.completed",
          name: requested.name,
          output,
          idempotencyKey: requested.idempotencyKey,
        })
      ).run;
    } catch (error) {
      if (error instanceof AgentEffectDeferredError) {
        if (!Number.isFinite(Date.parse(error.retryAt)))
          throw new Error("Invalid deferred effect retry timestamp");
        return transition(run, workerId, {
          status: "waiting",
          wakeAt: error.retryAt,
        });
      }
      const message = error instanceof Error ? error.message : "Effect failed";
      const failed = await append(run, workerId, {
        kind: "effect.failed",
        name: requested.name,
        output: { message },
        idempotencyKey: requested.idempotencyKey,
      });
      return transition(failed.run, workerId, {
        status: "failed",
        error: { code: "effect_failed", message, retryable: true },
      });
    }
  };

  return {
    start: async (input) => {
      const timestamp = new Date(now()).toISOString();
      const run: AgentRun = {
        id: input.idempotencyKey ?? id(),
        actor: input.actor,
        agent: input.agent,
        goal: input.goal,
        input: input.input,
        ...(input.parentRunId ? { parentRunId: input.parentRunId } : {}),
        status: "queued",
        budget: input.budget ?? {},
        usage: zeroUsage(),
        version: 0,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      await store.createRun(run);
      await emit({ type: "run.created", run });
      return run;
    },
    cancel: (runId) =>
      store.requestCancel({ runId, now: new Date(now()).toISOString() }),
    list: (input) => store.listRuns(input),
    inspect: async (runId) => {
      const run = await store.getRun(runId);
      return run ? { run, steps: await store.listSteps(runId) } : undefined;
    },
    workOne: async (workerId) => {
      const claimedAt = now();
      let run = await store.claimDue({
        workerId,
        now: new Date(claimedAt).toISOString(),
        leaseExpiresAt: new Date(claimedAt + leaseMs).toISOString(),
      });
      if (!run) return undefined;
      await emit({ type: "run.claimed", run });
      for (
        let count = 0;
        count < maxStepsPerClaim && run.status === "running";
        count += 1
      ) {
        const current = await store.getRun(run.id);
        if (!current) throw new Error("Claimed run disappeared");
        if (current.cancelRequestedAt) {
          run = await transition(current, workerId, { status: "cancelled" });
          break;
        }
        run = current;
        const steps = await store.listSteps(run.id);
        try {
          const resumed = await resumePendingEffect(run, workerId, steps);
          if (resumed) {
            run = resumed;
            continue;
          }
          run = await handle(
            run,
            workerId,
            await driver.next({
              run,
              steps,
              remaining: remainingBudget(run.budget, run.usage),
            }),
          );
        } catch (error) {
          if (
            error instanceof Error &&
            error.message.startsWith("Agent budget exceeded:")
          ) {
            run = await transition(run, workerId, {
              status: "failed",
              error: {
                code: "budget_exceeded",
                message: error.message,
                retryable: false,
              },
            });
            break;
          }
          throw error;
        }
      }
      if (run.status === "running") {
        run = await transition(run, workerId, { status: "queued" });
      }
      return run;
    },
  };
};
