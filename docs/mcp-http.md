# Authenticated Streamable HTTP mediation

The paired libraries now connect the read-only MCP gate to host-authenticated HTTP callers and TLS-verified downstream servers. Select the draft [PSP-MCP-HTTP-0.1 profile](../specs/profiles/PSP-MCP-HTTP-0.1.md) explicitly. It adds a portable transport boundary; token issuance, authorization UX, hosting and managed operations belong to the embedding application.

| TypeScript API | Python API | Purpose |
| --- | --- | --- |
| `HttpMcpClient.connect(config, credential)` | `HttpMcpClient.connect(config, credential)` | Authenticate to a fixed resource and pin discovery |
| `peer.registrations(server, approvals, now)` | Same | Build gate registrations from host-approved schemas/capabilities |
| `createMcpProxyService(gate, sessionId, controls)` | `create_mcp_proxy_service(...)` | Expose discovery/calls through the gate |
| `McpHttpServer(host, config).handle(request)` | Same | Owner-bound initialization, HTTP validation, cancellation and buffered output |
| `nodeHttpHandler(adapter)` | `make_http_handler(adapter)` | Attach to a host-owned HTTP(S) server |

Import proxy APIs from `@psp-cdl/mcpproxy/mcp` or `psp_cdl_mcpproxy.mcp`. HTTP server types/helpers are in `@psp-cdl/mcp-server/http` or `psp_cdl_mcp_server.http`. Imports open no listeners or connections. `connect` explicitly performs network I/O. See [paired runnable examples](../examples/http/README.md).

## Downstream client

```ts
const peer = await HttpMcpClient.connect({
  endpoint: "https://tools.example/mcp", allowLoopbackHttp: false,
  serverInfo: {name: "psp-cdl-reference", version: "0.1.0"}, timeoutMs: 5000
}, resource => credentials.accessTokenFor(resource));
const registrations = peer.registrations("records", hostApprovedTools, host.now);
// Construct McpDispatchGate(store, host, registryRevision, registrations).
// await peer.close() when the dedicated client is no longer needed.
```

```python
peer = HttpMcpClient.connect({
    "endpoint": "https://tools.example/mcp", "allowLoopbackHttp": False,
    "serverInfo": {"name": "psp-cdl-reference", "version": "0.1.0"}, "timeoutMs": 5000
}, credentials.access_token_for)
registrations = peer.registrations("records", host_approved_tools, host.now)
# Construct McpDispatchGate(store, host, registry_revision, registrations).
# peer.close() when finished.
```

The credential callback receives the exact fixed endpoint, never model arguments. Supply a separately acquired downstream access token. The callback may refresh host-owned credentials before a later request, but this adapter does not implement browser OAuth, discovery, consent, PKCE or token acquisition. It does not follow redirects or retry failed requests. Normal TLS verification stays enabled with optional `caPem` custom trust roots. Plain HTTP requires explicit loopback development opt-in.

Tool annotations do not authorize capabilities. Host approvals, immutable node affinity, coordinated session state and the dispatch/release policy callbacks remain required. JSON and finite SSE responses are buffered, bounded and validated; only checked structured objects reach the gate. Remote `_meta`, diagnostics and unmatched text are discarded or rejected. Discovery polling detects observed changes without providing atomic remote version checks.

## Inbound server

Configure `endpoint`, `allowLoopbackHttp`, `authorizationServers`, `maxSessions`, `sessionTtlMs` and `callTimeoutMs`; see the [shared schema](../schemas/mcp-http.schema.json). The host provides two callbacks:

1. `authenticate(token, resource)` validates token issuer, audience, lifetime/revocation and scopes. Return a tenant/subject principal or null. A callback returning an arbitrary principal is a test stub, not token validation.
2. `open(principal, cancelled)` opens a request-local service and returns `{service, close}`. Select the durable workflow session from authenticated host state, construct `createMcpProxyService`, and combine `cancelled` with any additional host cancellation/deadline controls. Close request-local resources in `close`.

Python opens SQLite in the request worker and shares one `OwnerCoordinator` across all gates and writers. Do not reuse a connection created in a different thread. The [HTTP fixtures](../scripts/http_fixtures.py) show this ownership pattern; their credentials and policies are synthetic.

The adapter rejects browser Origins and mismatched Host headers. It publishes protected-resource metadata, returns a metadata challenge on 401, handles POST/DELETE, and returns 405 for standalone GET streams. A host server or reverse proxy must preserve raw duplicate headers, route only the configured resource, verify TLS at the public boundary and enforce connection/worker quotas. Forwarded headers never determine endpoint identity.

## Persistence and cancellation

Keep durable PSP workflow state in the existing SQLite backend. HTTP transport sessions stay in bounded process memory: an opaque random ID binds the initialized peer to tenant/subject and tracks an active call. They expire absolutely and disappear on restart. They contain no reusable execution permission. Multiple workers need sticky session routing and the existing coordination constraints; this slice adds no distributed session store.

Cancellation uses a separate authenticated POST for the current request ID. It can run while the first request waits on a tool. The gate suppresses late results and releases its reservation when the callback finishes; cancelled HTTP requests end with an empty 204. Disconnecting alone does not cancel work. Downstream cancellation is a bounded best-effort notification; it cannot undo a request already received. Callbacks must cooperate, and only approved read-only tools are supported.

Run `python scripts/check-http-parity.py` after building. Current evidence covers 29 shared boundary cases, 42 real mixed-language HTTP/TLS gated calls and eight full HTTP caller → proxy → tool chains. The full parity command includes these checks. Unsupported: OAuth client flows, browser/CORS access, resumable or open-ended SSE, hot discovery refresh, atomic remote revision preconditions, mutating tools, distributed recovery and complete M3/M4 or topology conformance.
