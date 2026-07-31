# @absolutejs/agent-memory

Durable, provider-neutral memory for agents with tenant/user/agent/run scopes,
mandatory provenance digests, taint-compatible metadata, per-operation policy,
expiration, deletion, subject erasure, optimistic versions, and idempotent writes.

Values pass through an injected codec so production deployments can use KMS or
envelope encryption. Retrieval indexes are adapters: pgvector, a vector service,
or custom search can rank IDs without becoming the source of record. Retrieved
records remain labeled memory data; this package never promotes them to trusted
instructions. Use `validateWrite` with `@absolutejs/agent-trust` to reject poisoned
or inappropriately sensitive memories before persistence.
