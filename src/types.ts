export type AgentRunStatus =
  | "queued"
  | "running"
  | "waiting"
  | "suspended"
  | "handed_off"
  | "completed"
  | "failed"
  | "cancelled";

export type AgentIdentityPin = {
  descriptorId: string;
  descriptorVersion: string;
  descriptorDigest: string;
};

export type AgentActor = {
  tenantId: string;
  userId: string;
  agentId: string;
  delegationId?: string;
  organizationId?: string;
};

export type AgentBudget = {
  actions?: number;
  costMicros?: number;
  inputTokens?: number;
  outputTokens?: number;
  spendMinor?: number;
  wallTimeMs?: number;
};

export type AgentBudgetUsage = Required<AgentBudget>;

export type AgentRun = {
  id: string;
  parentRunId?: string;
  actor: AgentActor;
  agent: AgentIdentityPin;
  goal: string;
  input: unknown;
  output?: unknown;
  status: AgentRunStatus;
  budget: AgentBudget;
  usage: AgentBudgetUsage;
  version: number;
  cancelRequestedAt?: string;
  checkpoint?: unknown;
  wakeAt?: string;
  leaseOwner?: string;
  leaseExpiresAt?: string;
  error?: { code: string; message: string; retryable: boolean };
  createdAt: string;
  updatedAt: string;
};

export type AgentStepKind =
  | "observation"
  | "thought"
  | "message"
  | "effect.requested"
  | "effect.completed"
  | "effect.failed"
  | "checkpoint"
  | "handoff"
  | "wait"
  | "completed"
  | "failed";

export type AgentStep = {
  id: string;
  runId: string;
  sequence: number;
  kind: AgentStepKind;
  idempotencyKey?: string;
  name?: string;
  input?: unknown;
  output?: unknown;
  usage: AgentBudgetUsage;
  createdAt: string;
};

export type AgentRunEvent =
  | { type: "run.created"; run: AgentRun }
  | { type: "run.claimed"; run: AgentRun }
  | { type: "run.transitioned"; run: AgentRun }
  | { type: "step.appended"; run: AgentRun; step: AgentStep };

export type AgentRuntimeStore = {
  createRun(run: AgentRun): Promise<void>;
  getRun(id: string): Promise<AgentRun | undefined>;
  listSteps(runId: string): Promise<readonly AgentStep[]>;
  claimDue(input: {
    workerId: string;
    now: string;
    leaseExpiresAt: string;
  }): Promise<AgentRun | undefined>;
  heartbeat(input: {
    runId: string;
    workerId: string;
    expectedVersion: number;
    leaseExpiresAt: string;
    now: string;
  }): Promise<AgentRun | undefined>;
  appendStep(input: {
    runId: string;
    workerId: string;
    expectedVersion: number;
    step: AgentStep;
    now: string;
  }): Promise<AgentRun | undefined>;
  transition(input: {
    runId: string;
    workerId?: string;
    expectedVersion: number;
    status: AgentRunStatus;
    now: string;
    output?: unknown;
    checkpoint?: unknown;
    wakeAt?: string;
    error?: AgentRun["error"];
  }): Promise<AgentRun | undefined>;
  requestCancel(input: {
    runId: string;
    now: string;
  }): Promise<AgentRun | undefined>;
};

export type AgentEffectExecutor = {
  execute(input: {
    run: AgentRun;
    step: AgentStep;
    name: string;
    payload: unknown;
    idempotencyKey: string;
  }): Promise<unknown>;
};

export type AgentTransition =
  | {
      type: "continue";
      kind?: "observation" | "thought" | "message";
      name?: string;
      input?: unknown;
      output?: unknown;
      usage?: AgentBudget;
    }
  | {
      type: "effect";
      name: string;
      input: unknown;
      idempotencyKey: string;
      usage?: AgentBudget;
    }
  | { type: "checkpoint"; checkpoint: unknown; reason?: string }
  | { type: "wait"; until: string; reason: string; checkpoint?: unknown }
  | {
      type: "handoff";
      target: AgentIdentityPin;
      input: unknown;
      reason: string;
    }
  | { type: "complete"; output: unknown }
  | { type: "fail"; code: string; message: string; retryable?: boolean };

export type AgentDriverContext = {
  run: AgentRun;
  steps: readonly AgentStep[];
  remaining: AgentBudgetUsage;
};

export type AgentDriver = {
  next(context: AgentDriverContext): Promise<AgentTransition>;
};

export type AgentRuntime = {
  start(input: {
    actor: AgentActor;
    agent: AgentIdentityPin;
    goal: string;
    input: unknown;
    budget?: AgentBudget;
    idempotencyKey?: string;
    parentRunId?: string;
  }): Promise<AgentRun>;
  cancel(runId: string): Promise<AgentRun | undefined>;
  inspect(
    runId: string,
  ): Promise<{ run: AgentRun; steps: readonly AgentStep[] } | undefined>;
  workOne(workerId: string): Promise<AgentRun | undefined>;
};
