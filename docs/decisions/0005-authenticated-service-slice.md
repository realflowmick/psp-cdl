# ADR 0005: Reusable authenticated security service slice

Status: author-directed experimental implementation and project draft contract. Independent security review remains pending.

The author approved proceeding from the reusable codecs to MCP/API services. Implement a common service layer inside each `api-server` package; HTTP and `mcp-server` adapters delegate to it and to core/CDL. Keep transport and authentication integration injectable, with no account, key store, listener, model call or SaaS dependency created on import.

[Service Profile 0.1](../../specs/profiles/PSP-SERVICE-0.1.md) defines the first read-only slice: operation-bound verification and host-owned policy evaluation. The caller cannot supply authority or safeguard evidence. The service rechecks tenant/subject/operation ownership, fresh snapshot expiry and signature context. Results report observations and decisions without issuing reusable execution permits. This avoids pretending that read-only checks implement stateful replay protection.

Pin a small MCP stdio surface to 2025-11-25 and advertise only the two implemented tools. The existing RFC verification name is retained with an explicit draft operation binding; policy evaluation is a documented extension. Defer sessions, nodes, checkpoints and scan/decrypt/process until their state and key-management contracts exist. HTTP is a project-owned OpenAPI draft because RFC-PSP-API was not supplied. Do not infer the commercial product's API.

Validate the same synthetic cases in both languages and exchange actual HTTP/stdio messages with mixed-language clients and servers. Install all five working library packages outside editable source layouts. Publication remains disabled, the original seed full-workflow harness remains unsupported, and issue #5 stays open for the stateful slice. The existing solo-maintainer PR workflow applies; this author-directed step does not claim independent review.
