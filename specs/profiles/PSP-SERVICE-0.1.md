# PSP Reference Security Service Profile 0.1

Status: **project draft**. This is a first, read-only M3 slice, not the missing RFC-PSP-API or a complete PSP MCP server. Dedicated to the public domain under [CC0](../../LICENSES/CC0-1.0.txt).

The author directs reusable service implementations atop the accepted core/CDL libraries. This profile selects [Codec 1.0](PSP-CODEC-1.0.md), [Signature 2.0](PSP-SIGNATURE-2.0.md), [CDL Deterministic 1.0](CDL-DETERMINISTIC-1.0.md) and [Trust 1.0](PSP-TRUST-1.0.md). It leaves all archived RFC text unchanged. Consumers MUST explicitly select `PSP-SERVICE-0.1`.

## Authority and request binding

The trusted host MUST validate an opaque credential on every request and return tenant, subject and scopes, or reject. Token issuance, expiry, revocation, audience validation, secure storage and any OAuth/JWT integration belong to this host callback. Merely decoding a token or copying user-supplied identity is insufficient. The service does not have a default account or token. Scopes are `security:verify` and `policy:evaluate`.

The caller supplies `operation_id`. The host resolves an operation snapshot authorized for the authenticated tenant and subject. The service independently checks all three bindings even if a resolver returns another tenant's record. Missing and mismatched records both return `NOT_FOUND`. A snapshot MUST include an identifier-like policy revision, an expiration timestamp, verification policy and already-authoritative CDL evaluation units. At `now >= expires`, evaluation fails with `STALE_OPERATION`. The host MUST bind fresh evidence, capabilities, resolved policy origins, relevant input data and intended action to that operation. This read-only slice does not construct or persist those snapshots.

Callers MUST NOT supply keys, trust authority, tenant identity, policy facts, checks, grants, clocks or policy revisions as service arguments. Unknown request fields fail. Host callbacks are security dependencies; malicious callbacks are outside the service's trust model. Snapshots are resolved afresh on each call and are not cached by the library. Unexpected backend failures become generic `INTERNAL_ERROR` responses without exception text.

## Operations

The [OpenAPI draft](../../schemas/api/security-0.1.openapi.json) and [MCP tool contracts](../../schemas/mcp/security-tools-0.1.json) define the same requests and results.

| Operation | HTTP POST | MCP tool |
| --- | --- | --- |
| Verify signatures | `/v1/security/verify` | `realflow.security.verify` |
| Evaluate host policy | `/v1/policy/evaluate` | `realflow.policy.evaluate` |

Verification takes `operation_id` and 1–32 `sections`, each with unique `id` and markup `content`. Content MUST decode to exactly one leaf PSP section under Codec 1.0. An entire nested document can be supplied in that leaf's signed JSON envelope using the core library transport. The service never flattens nesting. Each signature MUST bind `tenant-id`, `operation-id`, and `policy-version` to the host context. Host key policy MUST disable unscoped signatures; authority, status, algorithm, time, all required context fields and allowed attributes are enforced by the core library. Other host-required bindings, such as session/node/audience, are supported through the same context.

Each result reports `valid` and verified metadata, or a stable error code. The summary counts every result; one valid section MUST NOT mask an invalid sibling. Results contain no original section bodies or private keys. Timestamp output uses integer Unix seconds in `expires`. These draft request bindings and response fields refine the illustrative RFC batch example; they are not an assertion of compatibility with an undocumented SaaS API.

Policy evaluation takes only `operation_id` and evaluates the host snapshot's resource/origin units conjunctively with the reusable CDL engine. Keep each originating legal-basis group and its parameters separate; the host MUST NOT flatten inherited permissions. `realflow.policy.evaluate` is a project extension, not one of the RFC's eleven mandatory tools.

Both results identify the profile, operation and policy revision. A verification result or policy `allow` is **not an execution ticket**. A future dispatch layer MUST rebind and revalidate live state, enforce obligations and prevent stale/replayed authorization before side effects. These services execute no tools, write no session state, and perform no decryption or model inference.

## Transports and limits

HTTP uses a host-validated Bearer credential and JSON request bodies. The framework-neutral adapter authenticates before JSON parsing or operation lookup. Duplicate headers, duplicate JSON keys, unexpected fields, compressed bodies, invalid UTF-8 and unsupported media types fail. Responses use `Cache-Control: no-store`; errors return `{error:{code}}`. Statuses distinguish malformed input (400), authentication (401), permission/origin failures (403), absent routes/operations (404), methods (405), stale snapshots (409), size (413), media (415), and internal failures (500). Policy denies and invalid signatures are evaluated results with HTTP 200, not HTTP authorization success.

The Node HTTP helper is an unbound development server intended to listen on loopback. It restricts Host to loopback names with its local port, rejects browser Origin, bounds request headers to 8 KiB, bounds bodies to 1 MiB, and sets five-second request/header/inactivity timeouts. The Python WSGI application has the same service body limits and loopback Host policy, rejects chunked transfer, and requires Content-Length. Its hosting server MUST reject ambiguous/duplicate HTTP framing, enforce read/connection timeouts, and limit concurrent connections; WSGI cannot recover duplicate headers already collapsed by a server. Neither helper is a public Internet deployment configuration. Remote use requires a separately configured trusted TLS/authentication ingress; CORS and forwarding-header identity are unsupported.

MCP uses the pinned [2025-11-25 lifecycle](https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle), [tools](https://modelcontextprotocol.io/specification/2025-11-25/server/tools), and [stdio transport](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports). A trusted process launcher supplies the credential through a callback outside JSON-RPC/model input. One dispatcher serves one peer; the tenant/subject identity cannot change after initialization. It supports initialize, initialized notification, ping, tools/list and tools/call. Discovery is filtered by current scope; calls authenticate again and recheck scope. Unsupported methods/tools fail and are never advertised as implemented. Protocol version negotiation returns 2025-11-25; a client unable to use that version must disconnect. The server advertises no list-change notifications.

Stdio uses bounded UTF-8 newline-delimited messages, at most 1 MiB per frame. Notifications never receive responses and cannot invoke tools. Oversized, invalid-UTF-8 or truncated frames terminate the transport with an error; hosts MUST close streams and report diagnostics only on stderr. No Streamable HTTP MCP transport, OAuth MCP server, subscriptions, prompts, resources, tasks, or server-to-client requests are implemented.

Standard request `_meta` objects are accepted but never used as identity, scope, policy or execution evidence. Progress tokens do not require this immediate read-only implementation to emit progress notifications. Client metadata cannot elevate discovery or invocation permissions.

Sessions, node persistence, checkpoints, resume tokens, replay-resistant mutations, scan/decrypt/process, complete mandatory-tool coverage and proxy dispatch remain unsupported. The generic full-workflow entry point continues to fail. This profile supplies scoped experimental service behavior and fixtures, not full protocol certification or measured security effectiveness.
