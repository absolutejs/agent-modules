import type { AgentRuntime } from "./types";

export type AgentRuntimeWorkerMetrics = {
  active: boolean;
  claimed: number;
  completed: number;
  draining: boolean;
  failed: number;
  lastRunMs: number;
  polls: number;
};

export const createAgentRuntimeWorker = (options: {
  onError?: (error: unknown) => void;
  pollIntervalMs?: number;
  runtime: Pick<AgentRuntime, "workOne">;
  workerId?: string;
}) => {
  const pollIntervalMs = options.pollIntervalMs ?? 1_000;
  const workerId = options.workerId ?? crypto.randomUUID();
  let active = false;
  let claimed = 0;
  let completed = 0;
  let draining = false;
  let failed = 0;
  let lastRunMs = 0;
  let polls = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const runOnce = async () => {
    if (active || draining) return undefined;
    active = true;
    polls += 1;
    const startedAt = Date.now();
    try {
      const run = await options.runtime.workOne(workerId);
      if (run) {
        claimed += 1;
        if (
          ["cancelled", "completed", "failed", "handed_off"].includes(
            run.status,
          )
        )
          completed += 1;
      }
      return run;
    } catch (error) {
      failed += 1;
      options.onError?.(error);
      throw error;
    } finally {
      lastRunMs = Date.now() - startedAt;
      active = false;
    }
  };
  const schedule = () => {
    if (timer || draining) return;
    timer = setTimeout(async () => {
      timer = undefined;
      try {
        await runOnce();
      } catch {
        // onError owns reporting; the next poll remains available.
      }
      schedule();
    }, pollIntervalMs);
  };

  return {
    drain: () => {
      draining = true;
      if (timer) clearTimeout(timer);
      timer = undefined;
    },
    metrics: (): AgentRuntimeWorkerMetrics => ({
      active,
      claimed,
      completed,
      draining,
      failed,
      lastRunMs,
      polls,
    }),
    runOnce,
    start: () => {
      draining = false;
      schedule();
    },
    stop: async () => {
      draining = true;
      if (timer) clearTimeout(timer);
      timer = undefined;
      while (active) await Bun.sleep(1);
    },
  };
};
