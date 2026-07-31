import { authorizeAgentSandboxAction } from "./policy";
import type {
  AgentCapabilityGrant,
  AgentSandbox,
  AgentSandboxAction,
  AgentSandboxAdapter,
  AgentSandboxOperationStore,
  AgentSandboxReceipt,
} from "./types";

const stable = (value: unknown): string =>
  JSON.stringify(value, (_key, item) =>
    item && typeof item === "object" && !Array.isArray(item)
      ? Object.fromEntries(
          Object.entries(item).sort(([a], [b]) => a.localeCompare(b)),
        )
      : item,
  );
const digest = async (value: unknown) =>
  `sha256:${Buffer.from(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(stable(value)))).toString("hex")}`;

export const createAgentSandbox = ({
  store,
  adapters,
  verifyGrant,
  resolveCredential,
  now = Date.now,
  id = () => crypto.randomUUID(),
}: {
  store: AgentSandboxOperationStore;
  adapters: Partial<Record<AgentSandboxAction["kind"], AgentSandboxAdapter>>;
  verifyGrant: (grant: AgentCapabilityGrant) => boolean | Promise<boolean>;
  resolveCredential: (input: {
    alias: string;
    grant: AgentCapabilityGrant;
  }) => Promise<string>;
  now?: () => number;
  id?: () => string;
}): AgentSandbox => ({
  execute: async ({ grant, action }) => {
    if (!(await verifyGrant(grant)))
      throw new Error("Capability grant proof is invalid");
    const timestamp = now();
    if (
      !Number.isFinite(Date.parse(grant.expiresAt)) ||
      Date.parse(grant.expiresAt) <= timestamp
    )
      throw new Error("Capability grant is expired");
    const capability = grant.capabilities.find(
      (value) => value.id === action.capabilityId,
    );
    if (!capability) throw new Error("Capability is not granted");
    authorizeAgentSandboxAction(capability, action);
    const adapter = adapters[action.kind];
    if (!adapter) throw new Error(`No sandbox adapter for ${action.kind}`);
    const requestDigest = await digest(action);
    const begun = await store.begin({
      grantId: grant.id,
      capabilityId: capability.id,
      requestId: action.requestId,
      maxUses: capability.maxUses,
      now: new Date(timestamp).toISOString(),
    });
    if (begun.state === "completed") return begun.result;
    if (begun.state === "in_progress")
      throw new Error("Sandbox action is already in progress");
    if (begun.state === "limit_exceeded")
      throw new Error("Capability use limit exceeded");
    try {
      const output = await adapter.execute({
        grant,
        capability,
        action,
        resolveCredential: (alias) => resolveCredential({ alias, grant }),
      });
      const receipt: AgentSandboxReceipt = {
        id: id(),
        grantId: grant.id,
        runId: grant.runId,
        requestId: action.requestId,
        capabilityId: capability.id,
        kind: action.kind,
        requestDigest,
        outputDigest: await digest(output),
        startedAt: new Date(timestamp).toISOString(),
        completedAt: new Date(now()).toISOString(),
      };
      const result = { output, receipt };
      if (
        !(await store.complete({
          grantId: grant.id,
          requestId: action.requestId,
          result,
          now: receipt.completedAt,
        }))
      )
        throw new Error("Sandbox operation completion was lost");
      return result;
    } catch (error) {
      await store.fail({ grantId: grant.id, requestId: action.requestId });
      throw error;
    }
  },
});
