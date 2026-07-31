# @absolutejs/agent-sandbox

Deny-by-default capability sandboxing for agent actions. Grants are scoped to
one durable run and one signed agent identity, expire, carry per-capability use
limits, and are verified through an issuer-agnostic callback.

HTTP access is restricted by origin, method, path, body/response size, and
credential binding. Each broker alias is bound to an exact header or process
input name; transport-controlled headers and process-loader variables remain
denied even if requested. Filesystem access uses boundary-safe absolute roots. Process
access uses exact executable allowlists, argument prefixes, working roots,
timeouts, and output limits. Credentials are resolved inside adapters and never
returned to the agent.

The broker persists an operation before executing it. Repeating the same
`grantId + requestId` returns the recorded result instead of repeating the
external action. Use the Postgres store in production or the memory store in
tests. The built-in fetch adapter rejects redirects so an allowed origin cannot
bounce an agent to an ungranted destination.

An adapter failure is deliberately left locked for reconciliation: the remote
system may have accepted the effect before the error reached the broker, so an
automatic retry would risk duplication. Filesystem adapters must resolve
symlinks/real paths before access; process adapters must enforce the grant's
timeout and output ceilings at the operating-system boundary.
