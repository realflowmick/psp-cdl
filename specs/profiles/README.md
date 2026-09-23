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
