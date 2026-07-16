import type { AgentBudget, AgentBudgetUsage } from "./types";

export const zeroUsage = (): AgentBudgetUsage => ({
  actions: 0,
  costMicros: 0,
  inputTokens: 0,
  outputTokens: 0,
  spendMinor: 0,
  wallTimeMs: 0,
});

export const normalizeUsage = (value: AgentBudget = {}): AgentBudgetUsage => {
  const result = { ...zeroUsage(), ...value };
  for (const [name, amount] of Object.entries(result)) {
    if (!Number.isSafeInteger(amount) || amount < 0)
      throw new Error(`Invalid budget usage: ${name}`);
  }
  return result;
};

export const addUsage = (
  left: AgentBudgetUsage,
  right: AgentBudgetUsage,
): AgentBudgetUsage => ({
  actions: left.actions + right.actions,
  costMicros: left.costMicros + right.costMicros,
  inputTokens: left.inputTokens + right.inputTokens,
  outputTokens: left.outputTokens + right.outputTokens,
  spendMinor: left.spendMinor + right.spendMinor,
  wallTimeMs: left.wallTimeMs + right.wallTimeMs,
});

export const remainingBudget = (
  budget: AgentBudget,
  usage: AgentBudgetUsage,
): AgentBudgetUsage => ({
  actions: Math.max(
    0,
    (budget.actions ?? Number.MAX_SAFE_INTEGER) - usage.actions,
  ),
  costMicros: Math.max(
    0,
    (budget.costMicros ?? Number.MAX_SAFE_INTEGER) - usage.costMicros,
  ),
  inputTokens: Math.max(
    0,
    (budget.inputTokens ?? Number.MAX_SAFE_INTEGER) - usage.inputTokens,
  ),
  outputTokens: Math.max(
    0,
    (budget.outputTokens ?? Number.MAX_SAFE_INTEGER) - usage.outputTokens,
  ),
  spendMinor: Math.max(
    0,
    (budget.spendMinor ?? Number.MAX_SAFE_INTEGER) - usage.spendMinor,
  ),
  wallTimeMs: Math.max(
    0,
    (budget.wallTimeMs ?? Number.MAX_SAFE_INTEGER) - usage.wallTimeMs,
  ),
});

export const budgetExceeded = (
  budget: AgentBudget,
  usage: AgentBudgetUsage,
  requested: AgentBudgetUsage,
) => {
  const next = addUsage(usage, requested);
  return (Object.keys(next) as Array<keyof AgentBudgetUsage>).find(
    (name) => budget[name] !== undefined && next[name] > (budget[name] ?? 0),
  );
};
