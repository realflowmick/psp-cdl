# MCP prompt refresh discovery

The opt-in `McpPromptRefresher` supplies `RefreshingLlmLoop`'s host refresh
callback from an approved MCP server. It supports expiration and interval
re-fetch over the existing bounded stdio and authenticated HTTP clients.
See [the draft profile](../specs/profiles/PSP-MCP-PROMPT-REFRESH-0.1.md).

The host first connects and reviews `peer.catalogSnapshot` (Python:
`catalog_snapshot`), including the selected server and exact tool schemas.
Only then pass the approved digest. Copying a newly discovered digest without
review is not an authorization decision. The default name is
`realflow.security.refresh`; `toolName` selects an explicitly approved equivalent.

```ts
import {McpPromptRefresher} from '@psp-cdl/llmproxy';

const refresher = new McpPromptRefresher(peer, {
  principal, sessionId, approvedCatalogDigest,
  now: host.now, cancelled: controls.cancelled
});
const refreshHost = {
  ...host,
  refresh: (principal, binding, request) =>
    refresher.refresh(principal, binding, request)
};
// Pass refreshHost to the existing RefreshingLlmLoop constructor.
```

```python
from psp_cdl_llmproxy import McpPromptRefresher

refresher = McpPromptRefresher(peer, {
    "principal": principal, "sessionId": session_id,
    "approvedCatalogDigest": approved_catalog_digest,
    "now": host.now, "cancelled": controls["cancelled"],
})
# Install refresher.refresh as the host's refresh callback.
```

Use one dedicated peer/refresher per authorized owner/session and share the live
cancellation source with loop controls. The loop supplies its deadline. The host
retains initial/binding prompt retrieval, signature policy, compatibility approval,
audit, persistence and CDL callbacks. Discovery never places refresh in the
provider's tool list. No raw transcript or authoritative binding is transmitted.

The receiving service advertises `mcpRefreshToolDefinition()` /
`mcp_refresh_tool_definition()`, a detached copy of the shared wire schema.
It authenticates the host, resolves the session under that identity, authorizes
the operation and signs a fresh SYSTEM section for current authoritative state.
It returns `{prompt: signedMarkup}` through the existing `McpToolService` adapter.
Session IDs from arguments do not authorize reads or signing. The service and
its signing-key custody remain host integrations; the default reference service
does not automatically expose refresh or load private keys.

`McpPromptRefresher.refresh` returns a structurally parsed envelope. It must be
used through the refresh loop or equivalent complete host verification; it does
not establish authenticity. The loop rejects tampering, incorrect scope, rollback,
same-version instruction changes, expiry and denied compatibility before inference.
Transport, discovery or structural errors reach the loop as sanitized host errors.

Catalog changes, schema mismatches, malformed output and cancellation withhold
the candidate. Connections do not retry or silently switch servers. Stdio identity,
HTTP resource credentials and TLS follow the existing transport guides. Plain HTTP
is only a separately opted-in loopback test facility. Optional revision negotiation
requires a cooperating server, a configured equivalent undotted tool name and an
approved `toolRevision`; polling alone is not an atomic remote revision guarantee.

Validation includes 29 shared boundary cases, seven loop acceptance/rejection
cases in each language and 32 real mixed-language stdio/HTTP calls with tool spies.
The tests compare exact wire arguments and withheld results. Run:

```sh
npm run check
uv run --locked python -m unittest discover -s implementations/python/tests -v
uv run --locked python scripts/check-parity.py
uv run --locked python scripts/generate-mcp-refresh-contract.py --check
uv run --locked python scripts/generate-mcp-refresh-vectors.py --check
```

Custom URLs, other triggers, OAuth acquisition, degraded continuation, streaming
and a hosted signing service remain unsupported. These checks establish the
documented subset, not complete conformance or measured security effectiveness.
