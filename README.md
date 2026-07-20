# @absolutejs/agent-trust

Provider-neutral provenance and taint tracking for agents. Every value carries
its purpose, authority, source, digest/proof, taints, parent digests, and
evidence-bearing transformations.

The central security rule is structural: external content is data, never an
instruction merely because it contains imperative language. `compileAgentContext`
returns separate instruction and data segments instead of interpolating tool,
web, file, or memory content into a privileged prompt. Sink policies then fail
closed before instructions or actions cross a trust boundary.

Use `compileGuardedAgentContext` at provider boundaries. It enforces the
instruction policy before compilation; the basic compiler also conservatively
downgrades externally authoritative or tainted values mislabeled as
instructions into the data channel.

Taints propagate through derived model output. A sanitizer may remove named
taints only while recording evidence and a new digest; there is no implicit
"trusted because the model said so" conversion. Proof verification is injected,
so signed discovery descriptors, DSSE, JWTs, or provider KMS can share the same
contract.
