# PSP MCP Prompt Refresh 0.1

Status: experimental opt-in project draft, pending public review. License: CC0-1.0.
References: PSP Core 3.2.0 §§21.11, 21.13–21.17, PSP-CODEC-1.0,
PSP-PROMPT-REFRESH-0.1 and the existing MCP transport profiles.
Published baselines and the embedded refresh loop retain their semantics.

## Discovery and authority

This extension supplies the host refresh callback through standard MCP
`tools/list` and `tools/call`. The host opens a dedicated authenticated peer,
reviews its detached catalog snapshot and explicitly approves its digest. The
default tool is `realflow.security.refresh`; an equivalent tool name is permitted
only through explicit host configuration. No fuzzy matching, descriptions,
model choice, fallback to another server or retry establishes authority.

`McpPromptRefresher` pins the exact tenant, subject and session at construction.
Each request must match that owner/session and carry a canonical current version.
Discovery must contain the selected tool with exactly the input/output schemas
in [the shared contract](../../schemas/mcp/prompt-refresh-tool-0.1.json).
The entire catalog is compared before and after calls. Changes reject the result
and close the peer; a host must independently approve a new connection.

Only the canonical refresh name is added to the legacy peer's accepted discovery
names; other dotted names remain outside that subset. Model dispatch registration
and affinity rules are unchanged. The separate host control channel conveys no
CDL capability or model-tool authorization. Hosts must keep refresh registrations
outside the provider's tool catalog and must authorize disclosure to the service.

## Wire subset and validation

The request contains exactly `session_id`, `current_version`, `trigger` and
`turn_count`. Triggers are expiration or interval; the count is a nonnegative
safe integer. Initial and binding prompt retrieval remain host callbacks.
Credentials, authoritative bindings, raw transcripts, policies and signing keys
are not request arguments. The receiving service authenticates the resource
credential and independently resolves/authorizes the session and signing scope;
`session_id` alone is never authority. This client extension does not implement
a managed signing service or an additional default reference-server tool.

The MCP structured result is exactly `{ "prompt": "<signed SYSTEM markup>" }`.
It is bounded to 262144 Unicode code points inside the existing transport and JSON
byte/depth limits. Optional text content must encode the same structured result.
It must parse as exactly one unnested SYSTEM section with text content. Extra
top-level material, malformed responses and additional structured fields reject.
Remote metadata is never forwarded as policy or model content.

Parsing the response does not verify its signature or authorize execution.
`RefreshingLlmLoop` still checks current trusted keys, exact session/provider/
policy binding, expiration, version continuity, freshness, compatibility approval,
audit acceptance and durable metadata before using the candidate. The existing
complete-transcript CDL checks and buffered output gates continue to apply.

## Cancellation, compatibility and limits

Hosts supply a live cancellation callback shared with the invocation and a clock
using the same Unix-second units as the loop. The deadline comes from the host's
loop binding. Cancellation/deadline checks precede discovery and follow the
buffered call. Existing transport timeouts bound network/pipe I/O; poisoned peers
close and do not automatically retry. Concurrent use of a dedicated peer is
unsupported. No cancellation result is released for execution.

Stdio and authenticated Streamable HTTP use their existing launcher/resource
credentials and TLS controls. Observed catalog comparison does not guarantee an
atomic remote revision. A negotiated revision-aware peer may use an explicitly
approved equivalent undotted tool and revision under PSP-MCP-REVISION-0.1; that
profile's cooperative-server and process-local limits still apply.

Custom refresh URLs, adaptive/checkpoint triggers, background refresh,
notification-driven catalog replacement, OAuth acquisition, degraded continuation,
streaming and automatic signer provisioning remain unsupported. This draft opens
public review; it does not record normative adoption, full RFC conformance,
production readiness or measured security effectiveness.
