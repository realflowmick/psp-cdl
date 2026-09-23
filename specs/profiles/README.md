# Reference implementation profiles

[PSP Signature Profile 2.0](PSP-SIGNATURE-2.0.md) is the normative proposed signing profile selected by PSP Core 3.2.0. It resolves PSP-E001 through PSP-E004 using three signed fields with complete protected content, strict expiration, JCS and explicit encoding/migration rules.

[CDL Deterministic Policy Profile 1.0](CDL-DETERMINISTIC-1.0.md) resolves CDL unknown terms, authorized negation, inheritance, capability aggregation, matrix matching, evidence and decision ordering. Its finite machine-readable table accounts for every Appendix B.2/B.3 row; terms outside this revision fail closed.

[PSP Trust and Enforcement Profile 1.0](PSP-TRUST-1.0.md) resolves the six-level taxonomy and separates proxy controls from inference-engine isolation. It defines minimum topology and actual mediation requirements without assuming independent failure modes.

These profiles are proposed standards adopted at the author's direction, with [a recorded decision](../../docs/decisions/0003-deterministic-policy-profile.md). They override the named baseline interpretations only when explicitly selected. Full RFC grammar coverage, service contracts, full RFC requirement extraction and production service conformance adapters remain pending. Fixture audits do not imply complete protocol or service conformance.

See [the decision record](../../docs/decisions/0002-signature-profile.md), [the archived baseline](../psp/RFC-PSP-CORE-v3_1_1.md), and [the specification process](../PROCESS.md).

[PSP Codec Profile 1.0](PSP-CODEC-1.0.md) now specifies the bounded markup/tree/JSON grammar, exact-source preservation and signed nested-document transport implemented by the reusable libraries. [ADR 0004](../../docs/decisions/0004-reusable-libraries.md) records adoption and compatibility limits. Executable library profile adapters now exist; service adapters and complete RFC grammar/requirement coverage remain pending.

[Service Profile 0.1](PSP-SERVICE-0.1.md) is a project draft for the first read-only authenticated HTTP/MCP slice. [ADR 0005](../../docs/decisions/0005-authenticated-service-slice.md) records its scope; it does not replace the missing RFC-PSP-API or assert full mandatory-tool coverage.

[MCP Dispatch Profile 0.1](PSP-MCP-DISPATCH-0.1.md) is a project draft for the first host-embedded read-only dispatch gate. It specifies exact flat affinity, immutable authenticated host registrations, finite schemas, coordinated local dispatch and buffered output checks. Full MCP transport mediation and durable effect dispatch remain pending.

[MCP Stdio Mediation Profile 0.1](PSP-MCP-STDIO-0.1.md) is the opt-in draft extension for launcher-authenticated stdio caller/proxy/downstream connections, pinned discovery, bounded I/O and checked structured responses. Remote HTTP/OAuth, hot registry updates, wire-level cancellation and complete topology claims remain unsupported.

[MCP HTTP Mediation Profile 0.1](PSP-MCP-HTTP-0.1.md) is the opt-in draft for resource-token authentication, verified TLS, bounded transport sessions, finite JSON/SSE buffering and owner-scoped wire cancellation. It consumes host-obtained tokens; it does not implement OAuth client flows or complete MCP conformance.

[Durable LLM Turns 0.1](PSP-LLM-DURABLE-0.1.md) extends the separate
[Buffered Loop 0.1](PSP-LLM-LOOP-0.1.md) draft with atomic state/answer receipts,
host-approved completion, explicitly configured lockdown and current-policy
recovery. It leaves the published unmanaged default and existing loop behavior
unchanged. Other completion modes remain unsupported.

[Automatic Prompt Refresh 0.1](PSP-PROMPT-REFRESH-0.1.md) adds an explicit embedded
profile for host-approved expiration/interval refresh, durable version floors and
atomic committed-turn counting. It uses host callbacks rather than the RFC's MCP
refresh discovery contract; unsupported triggers and any refresh failure deny
the invocation. Published RFC baselines remain unchanged.

[MCP Prompt Refresh 0.1](PSP-MCP-PROMPT-REFRESH-0.1.md) is an opt-in draft extension that supplies the host callback through approved MCP discovery with owner/session pinning, exact schemas and the existing loop verification gates.

[LLM Redirect 0.1](PSP-LLM-REDIRECT-0.1.md) is an opt-in draft for atomic source completion and same-owner target-session creation, host-approved CDL transfer and historical receipt recovery. It does not combine redirect with prompt refresh or scoped continuation.

[LLM Scoped Continuation 0.1](PSP-LLM-SCOPED-0.1.md) is an opt-in draft for signed SYSTEM replacement, deterministic host ingress/egress boundaries, accumulated threat state and durable hard-violation receipts after workflow completion. Tools and combined completion/refresh modes are unsupported.
