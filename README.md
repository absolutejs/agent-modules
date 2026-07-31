# AbsoluteJS Agent Modules

Independently published modules for the
[`@absolutejs/agent`](https://github.com/absolutejs/agent) stack. This
repository is their source monorepo; npm package names and independent versions
remain unchanged.

## Packages

| Workspace      | Package                         | Role                                          |
| -------------- | ------------------------------- | --------------------------------------------- |
| `conformance/` | `@absolutejs/agent-conformance` | Adversarial security and protocol conformance |
| `control/`     | `@absolutejs/agent-control`     | Authenticated operator API and console        |
| `discovery/`   | `@absolutejs/agent-discovery`   | Signed agent discovery                        |
| `inbox/`       | `@absolutejs/agent-inbox`       | Durable verified triggers and delivery        |
| `memory/`      | `@absolutejs/agent-memory`      | Scoped durable memory                         |
| `reputation/`  | `@absolutejs/agent-reputation`  | Evidence-based reputation                     |
| `runtime/`     | `@absolutejs/agent-runtime`     | Durable agent execution                       |
| `sandbox/`     | `@absolutejs/agent-sandbox`     | Capability sandboxing                         |
| `trust/`       | `@absolutejs/agent-trust`       | Provenance and taint enforcement              |

## Development

```sh
bun install
bun run typecheck
bun run test
bun run build
```

Each workspace retains its own license and changelog.
