# Host-embedded MCP dispatch gate

`McpDispatchGate` is the first experimental M4 slice in both languages. It authenticates callers, uses the durable active node's exact tool allow-list, evaluates CDL before invoking a registered tool, then validates and checks its buffered output before returning it. See the [draft profile](../specs/profiles/PSP-MCP-DISPATCH-0.1.md) for precise bounds and the [shared contract](../schemas/mcp-dispatch.schema.json).

This is a library API for an application host. The opt-in [MCP stdio adapter](mcp-stdio.md) now connects it to local caller and downstream processes. Remote HTTP/OAuth, hot network discovery, the LLM tool loop and complete topology enforcement remain pending. It requires no SaaS account, provider credential or external service.

## Setup and calls

Construct `OwnerCoordinator` from `@psp-cdl/api-server/persistence` or `psp_cdl_api_server.persistence`. Pass it as `coordinator` when constructing **every** `WorkflowStore` that can mutate the same owner state, then construct the gate:

```ts
import { McpDispatchGate } from "@psp-cdl/mcpproxy";
const gate = new McpDispatchGate(store, host, "registry-1", registrations);
const options = { deadline: host.now() + 30, cancelled: () => signal.aborted };
const tools = await gate.listTools(credential, trustedSessionId, options);
const result = await gate.callTool(credential, trustedSessionId,
  { name: "documents.read", arguments: { document: "example" } }, options);
```

```python
from psp_cdl_mcpproxy import McpDispatchGate
gate = McpDispatchGate(store, host, "registry-1", registrations)
options = {"deadline": host.now() + 30, "cancelled": cancelled_event.is_set}
tools = gate.list_tools(credential, trusted_session_id, options)
result = gate.call_tool(credential, trusted_session_id,
    {"name": "documents.read", "arguments": {"document": "example"}}, options)
```

These snippets assume the host clock uses seconds. The host controls the clock unit, deadline and session selector; transports must not copy them from model arguments. Python callbacks are synchronous; TypeScript callbacks may return promises. The [runnable paired examples](../examples/dispatch/README.md) use synthetic local tools and demonstrate a permitted call and a denied call.

The immutable node definition must contain the effective authorized affinity, for example `agents: "mcp://documents/read"`. Absence means no access. The initial subset supports exact flat MCP URIs. Wildcards, other schemes and unresolved inheritance require future work.

## Host responsibilities

| Host input | Required meaning |
| --- | --- |
| `authenticate(token)` | Current authenticated tenant, subject and scopes; calls require `tools:call`, listing requires `tools:list`. |
| Registration | Authenticated endpoint identity and revision, complete server/tool/transitive capabilities, closed input/output schemas, host-approved `readOnly`, and `invoke(arguments, options)`. Credentials stay in the adapter. |
| `snapshot(principal, session)` | Current authority/policy/registry revisions and expiry; complete capabilities for the actual output recipient and paths. |
| `policy(principal, binding, data, phase)` | Resolve each contributing input/output policy origin and trusted evidence. Return `{bindingDigest, resources}` using `bindingDigest(binding)` / `binding_digest(binding)`. Missing resources and mismatched bindings reject. |
| Coordination | Share the coordinator across writes, gates and authoritative changes needing atomic invalidation. `STATE_BUSY` is a retryable conflict, not a completed transition. |

The host must cover logging, caches, remote callees and recipient behavior in its capabilities and policy decisions. Raw tool claims cannot establish these facts. Neither an authenticated connection nor an allow decision proves a remote processor honors its declarations. The gate does not resolve arbitrary CDL-bearing schemas automatically; the host preserves each originating restriction using the CDL library.

Call results are `{data, provenance}`. The gate sets provenance to trust level 5 and binds digests to the checked arguments/output. It does not expose credentials, session state, authority bindings or raw exception details in results. Endpoint output cannot overwrite provenance. The metadata are local, unsigned records; an application forwarding them over a network needs its own authenticated envelope and release check for the actual recipient.

## Boundaries and next work

Only host-approved read-only endpoints are admitted. The name or an MCP read-only annotation is insufficient. Mutating tools return `UNSUPPORTED_TOOL_MODE`; there are no persistent call receipts, durable effect permits, retries or outbox recovery.

The coordinator is process-local and excludes all sessions of one tenant/subject while a call is active. Concurrent writes fail immediately; other owners proceed. Store reads remain available. Existing stores without a coordinator retain their earlier behavior and cannot be attached to the gate. Multiple processes or direct database writers need a separate atomic dispatch design.

Cancellation/deadlines are cooperative. Endpoint adapters must bound I/O and honor the supplied controls. A pending callback holds the reservation until it finishes; cancellation suppresses late output but cannot undo an already-dispatched request. Streaming is unsupported. The finite schema subset rejects unsupported keywords instead of claiming general MCP schema compatibility.

Run `npm run check`, the Python unittest suite, `python scripts/check-parity.py` and `python scripts/check-packages.py`. Shared scenarios compare actual tool-spy counts, suppressed responses and provenance across languages; concurrency tests hold an endpoint while a second writer attempts a transition. These checks support the draft slice only.
