import type { OperationStore, Operator } from "./index";

export type AgentPlaygroundCatalogItem = {
  description?: string;
  id: string;
  name: string;
  operations: string[];
  protocols: string[];
};

export type AgentPlaygroundPlan = {
  agentId: string;
  effects: string[];
  expiresAt: number;
  input: unknown;
  inputDigest: string;
  operation: string;
  operatorId: string;
  planId: string;
  spend?: { amountMinor: number; currency: string };
  status: "ready" | "approval-required" | "denied";
  steps: Array<{ description: string; protocol?: string; target?: string }>;
  summary: string;
};

export type AgentPlaygroundPlanStore = {
  get: (
    planId: string,
    operatorId: string,
  ) => Promise<AgentPlaygroundPlan | undefined>;
  save: (plan: AgentPlaygroundPlan) => Promise<void>;
};

export type AgentPlaygroundAdapter = {
  catalog: (
    operator: Operator,
  ) => Promise<AgentPlaygroundCatalogItem[]> | AgentPlaygroundCatalogItem[];
  /** Must not produce external effects. Return only a proposed plan. */
  plan: (
    request: { agentId: string; input: unknown; operation: string },
    operator: Operator,
  ) =>
    | Promise<
        Omit<
          AgentPlaygroundPlan,
          | "agentId"
          | "expiresAt"
          | "input"
          | "inputDigest"
          | "operation"
          | "operatorId"
          | "planId"
        >
      >
    | Omit<
        AgentPlaygroundPlan,
        | "agentId"
        | "expiresAt"
        | "input"
        | "inputDigest"
        | "operation"
        | "operatorId"
        | "planId"
      >;
  execute: (plan: AgentPlaygroundPlan, operator: Operator) => Promise<unknown>;
};

export const createMemoryAgentPlaygroundPlanStore = (
  now: () => number = Date.now,
): AgentPlaygroundPlanStore => {
  const plans = new Map<string, AgentPlaygroundPlan>();
  return {
    get: async (id, operatorId) => {
      const plan = plans.get(id);
      if (!plan || plan.operatorId !== operatorId || plan.expiresAt <= now())
        return undefined;
      return structuredClone(plan);
    },
    save: async (plan) => {
      for (const [id, existing] of plans)
        if (existing.expiresAt <= now()) plans.delete(id);
      if (plans.has(plan.planId))
        throw new Error("Playground plan already exists");
      plans.set(plan.planId, structuredClone(plan));
    },
  };
};

const digest = async (value: unknown) =>
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
const text = (value: unknown, field: string, maximum = 2_000) => {
  if (typeof value !== "string" || value === "" || value.length > maximum)
    throw new Error(`Invalid playground ${field}`);
  return value;
};
const list = <Value, Output>(
  values: Value[],
  map: (value: Value) => Output,
) => {
  if (!Array.isArray(values) || values.length > 1_000)
    throw new Error("Playground collection is too large");
  return values.map(map);
};
const safeCatalog = (items: AgentPlaygroundCatalogItem[]) =>
  list(items, (item) => ({
    ...(item.description === undefined
      ? {}
      : { description: text(item.description, "description") }),
    id: text(item.id, "agent id", 256),
    name: text(item.name, "agent name", 256),
    operations: list(item.operations, (value) => text(value, "operation", 256)),
    protocols: list(item.protocols, (value) => text(value, "protocol", 128)),
  }));

const page = (nonce: string) =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>AbsoluteJS Agent Playground</title><style nonce="${nonce}">:root{color-scheme:dark;font:15px/1.5 system-ui;background:#09090b;color:#fafafa}body{max-width:70rem;margin:auto;padding:2rem}label{display:block;margin:1rem 0}.grid{display:grid;grid-template-columns:1fr 1fr;gap:1rem}select,textarea,button{font:inherit;background:#18181b;color:#fff;border:1px solid #3f3f46;border-radius:.5rem;padding:.7rem;width:100%;box-sizing:border-box}textarea{min-height:14rem;font-family:ui-monospace,monospace}button{cursor:pointer;margin:.4rem 0}.execute{background:#14532d}pre{white-space:pre-wrap;background:#18181b;padding:1rem;border-radius:.5rem}.error{color:#fca5a5}@media(max-width:700px){.grid{grid-template-columns:1fr}}</style></head><body><h1>Agent Playground</h1><p>Plan first. Review exact effects. Execute only a bound server-side plan.</p><div class="grid"><div><label>Agent<select id="agent"></select></label><label>Operation<select id="operation"></select></label><label>JSON input<textarea id="input">{}</textarea></label><button id="plan">Create effect-free plan</button><button id="execute" class="execute" disabled>Execute reviewed plan</button></div><div><h2>Bound plan</h2><pre id="output">No plan yet.</pre></div></div><script nonce="${nonce}">(()=>{const base=location.pathname.replace(/\/$/,""),agent=document.querySelector("#agent"),operation=document.querySelector("#operation"),input=document.querySelector("#input"),output=document.querySelector("#output"),execute=document.querySelector("#execute");let plan;const headers={"content-type":"application/json","x-agent-control-intent":"mutate"};async function catalog(){const data=await fetch(base+"/api/catalog").then(r=>r.json());for(const item of data){const option=document.createElement("option");option.value=item.id;option.textContent=item.name;option.dataset.operations=JSON.stringify(item.operations);agent.append(option)}changed()}function changed(){operation.replaceChildren();for(const value of JSON.parse(agent.selectedOptions[0]?.dataset.operations??"[]")){const option=document.createElement("option");option.value=value;option.textContent=value;operation.append(option)}}agent.addEventListener("change",changed);document.querySelector("#plan").addEventListener("click",async()=>{try{const response=await fetch(base+"/api/plans",{method:"POST",headers,body:JSON.stringify({agentId:agent.value,operation:operation.value,input:JSON.parse(input.value)})});const data=await response.json();if(!response.ok)throw new Error(data.error??("HTTP "+response.status));plan=data;output.textContent=JSON.stringify(data,null,2);execute.disabled=data.status!=="ready"}catch(error){output.textContent=error.message;output.className="error"}});execute.addEventListener("click",async()=>{if(!plan)return;execute.disabled=true;const response=await fetch(base+"/api/plans/"+encodeURIComponent(plan.planId)+"/execute",{method:"POST",headers:{...headers,"idempotency-key":crypto.randomUUID()},body:"{}"});output.textContent=JSON.stringify(await response.json(),null,2)});catalog()})();</script></body></html>`;

export const createAgentPlaygroundHandler = (options: {
  adapter: AgentPlaygroundAdapter;
  authorize: (
    request: Request,
  ) => Promise<Operator | undefined> | Operator | undefined;
  basePath?: string;
  now?: () => number;
  operations: OperationStore;
  plans: AgentPlaygroundPlanStore;
  planTtlMs?: number;
}) => {
  const base = (options.basePath ?? "/agent-playground").replace(/\/$/u, "");
  const now = options.now ?? Date.now;
  const mutationAllowed = (request: Request, url: URL) =>
    request.headers.get("origin") === url.origin &&
    request.headers.get("x-agent-control-intent") === "mutate";
  return async (request: Request): Promise<Response | null> => {
    const url = new URL(request.url);
    if (url.pathname !== base && !url.pathname.startsWith(`${base}/`))
      return null;
    const operator = await options.authorize(request);
    if (!operator) return new Response("Unauthorized", { status: 401 });
    const scope =
      request.method === "GET"
        ? "agents:read"
        : url.pathname.endsWith("/execute")
          ? "agents:execute"
          : "agents:simulate";
    if (!operator.scopes.includes(scope))
      return new Response("Forbidden", { status: 403 });
    if (
      request.method === "GET" &&
      (url.pathname === base || url.pathname === `${base}/`)
    ) {
      const nonce = crypto.randomUUID().replaceAll("-", "");
      return new Response(page(nonce), {
        headers: {
          "cache-control": "no-store",
          "content-security-policy": `default-src 'none'; connect-src 'self'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}'; base-uri 'none'; frame-ancestors 'none'`,
          "content-type": "text/html; charset=utf-8",
          "x-content-type-options": "nosniff",
        },
      });
    }
    if (request.method === "GET" && url.pathname === `${base}/api/catalog`)
      return Response.json(
        safeCatalog(await options.adapter.catalog(operator)),
        {
          headers: { "cache-control": "no-store" },
        },
      );
    if (request.method === "POST" && url.pathname === `${base}/api/plans`) {
      if (!mutationAllowed(request, url))
        return new Response("Cross-site mutation denied", { status: 403 });
      const raw = await request.text();
      if (new TextEncoder().encode(raw).byteLength > 256_000)
        return Response.json({ error: "Input is too large" }, { status: 413 });
      let body: { agentId?: unknown; input?: unknown; operation?: unknown };
      try {
        body = JSON.parse(raw) as typeof body;
      } catch {
        return Response.json(
          { error: "Input must be valid JSON" },
          { status: 400 },
        );
      }
      const agentId = text(body.agentId, "agent id", 256);
      const operation = text(body.operation, "operation", 256);
      const inputDigest = await digest(body.input ?? null);
      const proposed = await options.adapter.plan(
        { agentId, input: structuredClone(body.input ?? null), operation },
        operator,
      );
      if (
        proposed.status !== "ready" &&
        proposed.status !== "approval-required" &&
        proposed.status !== "denied"
      )
        throw new Error("Invalid playground plan status");
      if (
        proposed.spend &&
        (!Number.isSafeInteger(proposed.spend.amountMinor) ||
          proposed.spend.amountMinor < 0 ||
          !/^[A-Z]{3}$/u.test(proposed.spend.currency))
      )
        throw new Error("Invalid playground plan spend");
      const plan: AgentPlaygroundPlan = {
        agentId,
        effects: list(proposed.effects, (value) => text(value, "effect", 128)),
        expiresAt: now() + (options.planTtlMs ?? 10 * 60_000),
        input: structuredClone(body.input ?? null),
        inputDigest,
        operation,
        operatorId: operator.id,
        planId: `plan_${crypto.randomUUID()}`,
        ...(proposed.spend
          ? {
              spend: {
                amountMinor: proposed.spend.amountMinor,
                currency: text(proposed.spend.currency, "currency", 3),
              },
            }
          : {}),
        status: proposed.status,
        steps: list(proposed.steps, (step) => ({
          description: text(step.description, "step description"),
          ...(step.protocol
            ? { protocol: text(step.protocol, "protocol", 128) }
            : {}),
          ...(step.target ? { target: text(step.target, "target") } : {}),
        })),
        summary: text(proposed.summary, "summary"),
      };
      await options.plans.save(plan);
      const { input: _input, ...visible } = plan;
      return Response.json(visible, {
        status: 201,
        headers: { "cache-control": "no-store" },
      });
    }
    const execute = new RegExp(
      `^${base.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}/api/plans/([^/]+)/execute$`,
      "u",
    ).exec(url.pathname);
    if (request.method !== "POST" || !execute?.[1])
      return new Response(null, { status: 405 });
    if (!mutationAllowed(request, url))
      return new Response("Cross-site mutation denied", { status: 403 });
    const operationId = request.headers.get("idempotency-key");
    if (!operationId)
      return Response.json(
        { error: "Idempotency-Key is required" },
        { status: 400 },
      );
    const plan = await options.plans.get(
      decodeURIComponent(execute[1]),
      operator.id,
    );
    if (!plan)
      return Response.json(
        { error: "Plan not found or expired" },
        { status: 404 },
      );
    if (plan.status !== "ready")
      return Response.json(
        { error: `Plan is ${plan.status}` },
        { status: 409 },
      );
    const binding = await digest({
      inputDigest: plan.inputDigest,
      planId: plan.planId,
    });
    let claim;
    try {
      claim = await options.operations.claim(
        `playground:${plan.planId}`,
        binding,
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
    const result = await options.adapter.execute(
      structuredClone(plan),
      operator,
    );
    if (
      !(await options.operations.complete(
        `playground:${plan.planId}`,
        binding,
        result,
      ))
    )
      throw new Error("Playground execution completion lost");
    return Response.json(result);
  };
};
