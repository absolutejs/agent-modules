import type { OperationStore, Operator } from "./index";

export type AgentControlSnapshot = {
  agents: Array<{
    description?: string;
    id: string;
    status: string;
  }>;
  approvals: Array<{
    action: string;
    agentId: string;
    id: string;
    requestedAt: string;
    risk?: string;
    summary: string;
  }>;
  delegations: Array<{
    expiresAt?: string;
    from: string;
    id: string;
    scopes: string[];
    to: string;
  }>;
  memories: Array<{
    agentId: string;
    id: string;
    scope: string;
    updatedAt: string;
  }>;
  reputations: Array<{
    confidence: number;
    scope: string;
    score: number;
    subject: string;
  }>;
  runs: Array<{
    agentId: string;
    budget?: { limit: number; spent: number; unit: string };
    id: string;
    startedAt: string;
    status: string;
  }>;
};

export type AgentControlConsoleData = {
  decideApproval: (input: {
    approvalId: string;
    decision: "approve" | "deny";
    operatorId: string;
    reason: string;
  }) => Promise<unknown>;
  snapshot: (operator: Operator) => Promise<AgentControlSnapshot>;
};

const hash = async (value: unknown) =>
  [
    ...new Uint8Array(
      await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(JSON.stringify(value)),
      ),
    ),
  ]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

const bounded = (value: unknown, field: string) => {
  if (typeof value !== "string" || value.length > 2_000)
    throw new Error(`Invalid agent control snapshot ${field}`);
  return value;
};
const boundedNumber = (value: unknown, field: string) => {
  if (typeof value !== "number" || !Number.isFinite(value))
    throw new Error(`Invalid agent control snapshot ${field}`);
  return value;
};
const rows = <Value, Output>(
  value: Value[],
  map: (item: Value) => Output,
): Output[] => {
  if (!Array.isArray(value) || value.length > 1_000)
    throw new Error("Agent control snapshot collection is too large");
  return value.map(map);
};

export const sanitizeAgentControlSnapshot = (
  source: AgentControlSnapshot,
): AgentControlSnapshot => ({
  agents: rows(source.agents, (item) => ({
    ...(item.description === undefined
      ? {}
      : { description: bounded(item.description, "agent.description") }),
    id: bounded(item.id, "agent.id"),
    status: bounded(item.status, "agent.status"),
  })),
  approvals: rows(source.approvals, (item) => ({
    action: bounded(item.action, "approval.action"),
    agentId: bounded(item.agentId, "approval.agentId"),
    id: bounded(item.id, "approval.id"),
    requestedAt: bounded(item.requestedAt, "approval.requestedAt"),
    ...(item.risk === undefined
      ? {}
      : { risk: bounded(item.risk, "approval.risk") }),
    summary: bounded(item.summary, "approval.summary"),
  })),
  delegations: rows(source.delegations, (item) => ({
    ...(item.expiresAt === undefined
      ? {}
      : { expiresAt: bounded(item.expiresAt, "delegation.expiresAt") }),
    from: bounded(item.from, "delegation.from"),
    id: bounded(item.id, "delegation.id"),
    scopes: rows(item.scopes, (scope) => bounded(scope, "delegation.scope")),
    to: bounded(item.to, "delegation.to"),
  })),
  memories: rows(source.memories, (item) => ({
    agentId: bounded(item.agentId, "memory.agentId"),
    id: bounded(item.id, "memory.id"),
    scope: bounded(item.scope, "memory.scope"),
    updatedAt: bounded(item.updatedAt, "memory.updatedAt"),
  })),
  reputations: rows(source.reputations, (item) => ({
    confidence: boundedNumber(item.confidence, "reputation.confidence"),
    scope: bounded(item.scope, "reputation.scope"),
    score: boundedNumber(item.score, "reputation.score"),
    subject: bounded(item.subject, "reputation.subject"),
  })),
  runs: rows(source.runs, (item) => ({
    agentId: bounded(item.agentId, "run.agentId"),
    ...(item.budget === undefined
      ? {}
      : {
          budget: {
            limit: boundedNumber(item.budget.limit, "run.budget.limit"),
            spent: boundedNumber(item.budget.spent, "run.budget.spent"),
            unit: bounded(item.budget.unit, "run.budget.unit"),
          },
        }),
    id: bounded(item.id, "run.id"),
    startedAt: bounded(item.startedAt, "run.startedAt"),
    status: bounded(item.status, "run.status"),
  })),
});

const page = (nonce: string) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>AbsoluteJS Agent Control</title><style nonce="${nonce}">
:root{color-scheme:dark;font:15px/1.45 system-ui,sans-serif;background:#09090b;color:#fafafa}body{margin:0}header{padding:1.2rem 1.5rem;border-bottom:1px solid #27272a;display:flex;align-items:center;justify-content:space-between}main{padding:1.5rem;display:grid;gap:1.25rem}.status{color:#a1a1aa}.error{color:#fca5a5}section{background:#18181b;border:1px solid #27272a;border-radius:.75rem;overflow:auto}h2{font-size:1rem;margin:0;padding:1rem}table{border-collapse:collapse;width:100%;min-width:42rem}th,td{text-align:left;padding:.7rem 1rem;border-top:1px solid #27272a;vertical-align:top}th{color:#a1a1aa;font-size:.8rem;text-transform:uppercase}button{background:#27272a;color:#fff;border:1px solid #3f3f46;border-radius:.4rem;padding:.4rem .65rem;margin:.15rem;cursor:pointer}button.approve{background:#14532d}button.deny{background:#7f1d1d}code{font-size:.8rem} @media(max-width:700px){main{padding:.75rem}header{padding:1rem}}
</style></head><body><header><strong>AbsoluteJS Agent Control</strong><span id="status" class="status">Loading…</span></header><main id="content"></main>
<script nonce="${nonce}">(()=>{const base=location.pathname.replace(/\/$/,"");const root=document.querySelector("#content"),status=document.querySelector("#status");const columns={agents:["id","status","description"],approvals:["id","agentId","action","summary","risk","requestedAt"],runs:["id","agentId","status","startedAt","budget"],delegations:["id","from","to","scopes","expiresAt"],memories:["id","agentId","scope","updatedAt"],reputations:["subject","scope","score","confidence"]};const text=v=>v==null?"":typeof v==="object"?JSON.stringify(v):String(v);function render(data){root.replaceChildren();for(const [name,fields] of Object.entries(columns)){const section=document.createElement("section"),heading=document.createElement("h2"),table=document.createElement("table"),head=document.createElement("tr");heading.textContent=name[0].toUpperCase()+name.slice(1);for(const field of fields){const th=document.createElement("th");th.textContent=field;head.append(th)}if(name==="approvals"){const th=document.createElement("th");th.textContent="Decision";head.append(th)}table.append(head);for(const item of data[name]??[]){const row=document.createElement("tr");for(const field of fields){const td=document.createElement("td");td.textContent=text(item[field]);row.append(td)}if(name==="approvals"){const td=document.createElement("td");for(const decision of ["approve","deny"]){const button=document.createElement("button");button.className=decision;button.textContent=decision;button.addEventListener("click",()=>decide(item.id,decision));td.append(button)}row.append(td)}table.append(row)}section.append(heading,table);root.append(section)}}async function load(){try{const response=await fetch(base+"/api/snapshot",{headers:{accept:"application/json"}});if(!response.ok)throw new Error("Snapshot failed: "+response.status);render(await response.json());status.textContent="Live";status.className="status"}catch(error){status.textContent=error.message;status.className="error"}}async function decide(id,decision){const reason=prompt("Reason for "+decision+":");if(!reason)return;status.textContent="Applying…";const response=await fetch(base+"/api/approvals/"+encodeURIComponent(id)+"/"+decision,{method:"POST",headers:{"content-type":"application/json","idempotency-key":crypto.randomUUID(),"x-agent-control-intent":"mutate"},body:JSON.stringify({reason})});if(!response.ok){status.textContent="Decision failed: "+response.status;status.className="error";return}await load()}load()})();</script></body></html>`;

export const createAgentControlConsoleHandler = (options: {
  authorize: (
    request: Request,
  ) => Promise<Operator | undefined> | Operator | undefined;
  basePath?: string;
  data: AgentControlConsoleData;
  now?: () => number;
  operations: OperationStore;
}) => {
  const basePath = (options.basePath ?? "/agent-control").replace(/\/$/u, "");
  const now = options.now ?? Date.now;
  return async (request: Request): Promise<Response | null> => {
    const url = new URL(request.url);
    if (url.pathname !== basePath && !url.pathname.startsWith(`${basePath}/`))
      return null;
    const operator = await options.authorize(request);
    if (!operator) return new Response("Unauthorized", { status: 401 });
    const required =
      request.method === "GET" ? "agents:read" : "agents:approve";
    if (!operator.scopes.includes(required))
      return new Response("Forbidden", { status: 403 });
    if (
      request.method === "GET" &&
      (url.pathname === basePath || url.pathname === `${basePath}/`)
    ) {
      const nonce = crypto.randomUUID().replaceAll("-", "");
      return new Response(page(nonce), {
        headers: {
          "cache-control": "no-store",
          "content-security-policy": `default-src 'none'; connect-src 'self'; img-src 'self'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'`,
          "content-type": "text/html; charset=utf-8",
          "referrer-policy": "no-referrer",
          "x-content-type-options": "nosniff",
        },
      });
    }
    if (
      request.method === "GET" &&
      url.pathname === `${basePath}/api/snapshot`
    ) {
      return Response.json(
        sanitizeAgentControlSnapshot(await options.data.snapshot(operator)),
        {
          headers: { "cache-control": "no-store" },
        },
      );
    }
    const match = new RegExp(
      `^${basePath.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}/api/approvals/([^/]+)/(approve|deny)$`,
      "u",
    ).exec(url.pathname);
    if (!match?.[1] || !match[2] || request.method !== "POST")
      return new Response(null, { status: 405 });
    if (
      request.headers.get("origin") !== url.origin ||
      request.headers.get("x-agent-control-intent") !== "mutate"
    )
      return new Response("Cross-site mutation denied", { status: 403 });
    const operationId = request.headers.get("idempotency-key");
    const body = (await request.json().catch(() => undefined)) as
      | { reason?: string }
      | undefined;
    if (!operationId || !body?.reason || body.reason.length > 1_000)
      return Response.json(
        { error: "Idempotency-Key and a bounded reason are required" },
        { status: 400 },
      );
    const input = {
      approvalId: decodeURIComponent(match[1]),
      decision: match[2] as "approve" | "deny",
      operatorId: operator.id,
      reason: body.reason,
    };
    const digest = await hash(input);
    let claim;
    try {
      claim = await options.operations.claim(
        operationId,
        digest,
        now(),
        30_000,
      );
    } catch (error) {
      return Response.json(
        { error: error instanceof Error ? error.message : "conflict" },
        { status: 409 },
      );
    }
    if (claim.response !== undefined) return Response.json(claim.response);
    if (!claim.acquired)
      return Response.json(
        { error: "operation in progress" },
        { status: 409, headers: { "retry-after": "5" } },
      );
    const response = await options.data.decideApproval(input);
    if (!(await options.operations.complete(operationId, digest, response)))
      throw new Error("Approval operation completion lost");
    return Response.json(response);
  };
};
