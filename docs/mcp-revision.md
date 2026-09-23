# Approved tool revisions and refresh

The opt-in [draft revision profile](../specs/profiles/PSP-MCP-REVISION-0.1.md) adds remote revision preconditions to both MCP clients, plus host-only registry replacement. It addresses a limit of before/after discovery: a server can otherwise select changed code between discovery and invocation. The receiving server must participate in the protocol. This remains an embeddable reference library; it adds no hosted catalog, approval UI, account system or commercial SaaS dependency.

## Receiving server

Import `RevisionedToolRegistry` from `@psp-cdl/mcp-server/revision` or `psp_cdl_mcp_server.revision`. Construct it with a host implementing `authenticate(token)` and `authorize(principal, toolName, phase)`, where phase is `discover`, `invoke` or `release` and discovery has a null tool name. Return an explicit boolean. Authentication must validate the resource-bound credential; tool scopes and owner identity are checked again by the registry. Supply read-only registrations with `name`, `revision`, `readOnly: true`, exact object `inputSchema`/`outputSchema`, and `invoke(args, context)`. Context contains the principal and a cancellation predicate, not the credential.

`registry.service(cancelled)` is a `McpServer` tool service. For HTTP, retain one registry shared across request-local services and publishers, and pass the transport's cancellation predicate to each service. Python uses a lock for catalog selection and execution leases; it runs user callbacks outside that lock. TypeScript performs the selection and lease increment without an intervening await. Host callbacks still need bounded execution and tool-specific input validation; the registry is not a general JSON Schema validator or PDP.

`registry.publish(expectedDescriptor, newTools)` atomically installs a complete replacement only when no calls hold a lease. Use `registry.revision` for the expected descriptor. A successful publication increments generation even for identical schemas and tool revisions. Every process restart uses a fresh epoch by default. Never reuse a supplied epoch across restarts. Hosts must publish changes to behavior, configuration or dependencies through the same registry; changes behind an unchanged callback are outside the library's control.

## Client approval and replacement

Set `revisionProfile: "PSP-MCP-REVISION-0.1"` in the existing stdio or HTTP connection configuration. The server must negotiate the extension. There is no silent fallback. A peer refusing initialize surfaces the transport's `REMOTE_ERROR`; a successful initialize without the required extension reports `REVISION_UNSUPPORTED`.

| TypeScript | Python | Purpose |
| --- | --- | --- |
| `peer.catalogSnapshot` | `peer.catalog_snapshot` | Detached catalog, remote revision and approval digest |
| `peer.catalogDigest` | `peer.catalog_digest` | Approval digest; includes the remote revision in this mode |
| `peer.registrations(server, approvals, now, approvedDigest)` | Same positional arguments | Bind an explicit host review to this exact snapshot |
| `gate.registryRevision` | `gate.registry_revision` | Current local registry version |
| `gate.replaceRegistry(expected, next, registrations)` | `gate.replace_registry(expected, next, registrations)` | Replace all registrations on an idle gate |

The reviewed approval must include exact schema and tool revision matches, read-only admission and complete capability sources. Do not blindly approve the snapshot because the peer supplied it. The digest is a compare token for a host review, not a credential or signature. Keep approvals, endpoint configuration, credentials and workflow authority outside model inputs.

For refresh, open a new peer and review its snapshot, then build the replacement registrations with the approved digest. A partial or invalid candidate must not reach the gate. Compare-and-replace the gate using a new local revision identifier, publish matching host authority, then retire the old peer. Calls between gate replacement and authority publication fail with `STALE_AUTHORITY`; they do not automatically adopt authority. A failed candidate should be closed while retaining the old connection. Hosts must coordinate publication across all serving gates, including any gates constructed per HTTP request.

Replacement fails with `REGISTRY_BUSY` during any discovery/call, including authentication and result release, regardless of owner. It also rejects a stale expected revision or any previously used local revision identifier. There is room for 4,096 local versions per gate lifecycle. Discovery refresh does not broaden existing node affinity, waive CDL restrictions or approve new tools automatically. No administrative operation is exposed through MCP.

## Checks and limits

Run `uv run --locked python scripts/check-revision-parity.py` after building TypeScript. It executes 23 shared vectors and 36 real mixed-language stdio/HTTP checks, including replacement by a newly approved peer. [Paired examples](../examples/revision/README.md) show successful replacement and publication.

A mismatched precondition reaches no registered callback. Missing or forged receipts suppress output, but a post-call failure cannot undo a call or disclosed input. Existing proxy gates sanitize downstream call failures to `TOOL_FAILED`. These are consistency checks against a cooperating authenticated server, not proof against dishonest declarations. Registries, leases and peer sessions are process-local. Distributed publication, notification-driven refresh, mutating tools and durable effect recovery remain unsupported. Packages remain private and the profile remains pending review.
