# @absolutejs/agent-discovery

Signed, searchable, provider-neutral discovery for AI agents.

The canonical descriptor schema is live at
<https://absolutejs.github.io/agents/schemas/agent-discovery/v1.json>. Version
0.2 also understands Arazzo and WebMCP interfaces. The original
`absolutejs.com` schema identifier remains verifiable during migration, but new
documents emitted with `ABSOLUTE_AGENT_SCHEMA` use the live immutable URL.

One descriptor publishes an agent through several interoperable surfaces:

- `/.well-known/absolute-agent.json` — full signed capability descriptor
- `/.well-known/absolute-agents.json` — multi-agent index
- `/.well-known/agent-card.json` — A2A 1.0 projection
- `/.well-known/absolute-agent.jsonld` — Schema.org JSON-LD projection
- `/agents.txt` — concise model- and human-readable index
- `/agents-sitemap.xml` — crawler index

Descriptors expose capabilities, effects, scopes, interfaces, authentication
metadata, languages, payment protocols, examples, publisher identity, and key
discovery. They are signed through a KMS/HSM-ready seam and can be indexed by
the in-memory or PostgreSQL registry without choosing an auth or model provider.

```ts
import {
  createAgentDiscoveryHandler,
  signAgentDocument,
} from "@absolutejs/agent-discovery";

const signed = await signAgentDocument(document, kmsSigner);
const discover = createAgentDiscoveryHandler({ documents: [signed] });

export default { fetch: discover };
```

## Secure crawling

`fetchAgentDocument` requires an injected fetch implementation. In production,
use `@absolutejs/egress` so DNS resolution, redirects, private networks, byte
limits, and credential injection remain host-controlled. Discovery never treats
publisher text as instructions or proof of authorization.

## Registry

`createAgentRegistry` verifies signatures at publication time and provides
deterministic filtered search. `createPostgresAgentRegistry` stores the complete
signed document, verification result, freshness timestamps, and a full-text index.
Apply `agentDiscoveryPostgresSchemaSql()` through your migration system first.

`createAgentRegistryHandler` serves registry metadata at
`/.well-known/absolute-agent-registry.json` and search, lookup, and submission at
`/v1/agents`. Publishing is deny-by-default until the host supplies an
`authorizePublish` hook; accepted submissions still have to pass signature and
descriptor verification. Registries can advertise federation feeds so independent
indexes can exchange verified records without introducing a central provider.
