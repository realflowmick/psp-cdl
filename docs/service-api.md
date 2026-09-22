# Reusable security service API

The first M3 slice is implemented in both languages. The `api-server` library owns authenticated, operation-bound verification and policy evaluation. The HTTP adapter and `mcp-server` library use that same service and the existing core/CDL codecs and evaluator. Importing a package starts no listener and loads no credentials. The [service profile](../specs/profiles/PSP-SERVICE-0.1.md) documents its draft wire contract and limitations.

| Interface | TypeScript | Python |
| --- | --- | --- |
| Shared service | `@psp-cdl/api-server`: `SecurityService` | `psp_cdl_api_server.SecurityService` |
| HTTP handler | `@psp-cdl/api-server/http`: `handleHttp` | `psp_cdl_api_server.http.handle_http` |
| HTTP hosting | `createHttpServer` (unbound Node server) | `create_wsgi_app` (WSGI application) |
| MCP dispatcher | `@psp-cdl/mcp-server`: `McpServer` | `psp_cdl_mcp_server.McpServer` |
| MCP stdio runner | `@psp-cdl/mcp-server/stdio`: `serveStdio` | `psp_cdl_mcp_server.stdio.serve_stdio` |

## Host integration

Provide a trusted host with `authenticate(token)`, `resolve(principal, operationId)` and `now()`. TypeScript callbacks may be asynchronous; the Python interface is synchronous and can be hosted behind an appropriate worker pool. Authentication must validate the credential, including its expiry/revocation/audience, and return `{tenantId, subjectId, scopes}` or null/None. The service does not provide an identity provider or accept caller-declared identities. Apply bounded callback deadlines and request quotas in the host.

Resolve returns an authorized snapshot containing `tenantId`, `subjectId`, `operationId`, `policyVersion`, `expires`, `verification`, and `resources`, or null/None. The service checks ownership again, rejects expired snapshots and keeps lookup failures indistinguishable across tenants/subjects. The snapshot is host-owned configuration/state, not a public request schema. A resolver may use a database later; no database format is prescribed in this slice.

`verification` is the [core verification policy](library-api.md) without `now`, which comes from the host clock. Its context must include `tenant-id`, `operation-id` and `policy-version` matching the snapshot. All keys must set `allowUnscoped: false`; register applicable context fields in `allowedAttributes`. Additional session/node/audience bindings can be required by the host. Keep key material and authoritative context outside model input.

`resources` is a list of CDL evaluation units, each with `classes`, `covenants`, `capabilities`, `checks`, `parameters` and `context`. The host supplies authenticated, fresh, operation-bound evidence and preserves each originating restriction as described in the library guide. The public policy request contains only `operation_id`. No wire caller can replace `resources` or claim a safeguard passed.

Given your host implementation, the same service can be used directly or attached to a transport:

```ts
import { SecurityService } from "@psp-cdl/api-server";
import { createHttpServer } from "@psp-cdl/api-server/http";
import { McpServer } from "@psp-cdl/mcp-server";
import { serveStdio } from "@psp-cdl/mcp-server/stdio";

const service = new SecurityService(host); // Your authenticated ServiceHost.
const decision = await service.invoke("evaluate", { operation_id: "op-1" }, token);

// Choose a transport in the embedding application:
const http = createHttpServer(service);
http.listen(8080, "127.0.0.1");
// Or: await serveStdio(new McpServer(service, () => launcherCredential));
```

```python
from psp_cdl_api_server import SecurityService
from psp_cdl_api_server.http import create_wsgi_app
from psp_cdl_mcp_server import McpServer
from psp_cdl_mcp_server.stdio import serve_stdio

service = SecurityService(host)  # Your authenticated ServiceHost.
decision = service.invoke("evaluate", {"operation_id": "op-1"}, token)
application = create_wsgi_app(service)  # Supply to a suitably configured WSGI host.
# Or: serve_stdio(McpServer(service, lambda: launcher_credential))
```

For HTTP, requests use Bearer authorization and `application/json`. The built-in hosting helpers require loopback Host names with a port and reject browser Origin. WSGI hosting must enforce framing-header validity, connection/read timeouts and concurrency limits before passing requests to the application. These helpers do not configure public TLS ingress, OAuth, CORS or forwarding-header trust. For MCP stdio, the trusted launcher supplies the credential outside JSON-RPC. Reauthentication detects revoked credentials; an initialized connection cannot switch tenant/subject. Scope-filtered discovery advertises only the implemented tools.

## Calling the draft endpoints

`POST /v1/policy/evaluate` or `realflow.policy.evaluate` accepts:

```json
{"operation_id":"op-1"}
```

`POST /v1/security/verify` or `realflow.security.verify` accepts `operation_id` and a `sections` array of `{id, content}`. `content` is one signed leaf section produced by the existing codec; wrap an entire nested document using `signDocument` / `sign_document`. Batches contain 1–32 unique section IDs and the entire request is limited to 1 MiB. Verification never returns section contents.

Results identify `profile`, `operation_id` and `policy_version`. Policy results include `decision` and ordered `reasonCodes`; verification results include per-section validity and a full summary. Check every applicable result. HTTP 200 and MCP `isError: false` mean evaluation completed, even when the decision is deny or signatures are invalid. These results are not dispatch permits. Proxies must revalidate live state and enforce obligations before actual tool calls.

See the complete [OpenAPI draft](../schemas/api/security-0.1.openapi.json) and [MCP schemas](../schemas/mcp/security-tools-0.1.json). A JSON-RPC protocol error is separate from a tool-execution error; tool errors contain stable codes without backend exception text. `SecurityService` does not advertise mutation tools. Hosts can explicitly select the separate [workflow service](workflow-api.md) to enable six session/node/checkpoint methods; decryption and full workflow execution remain unsupported.

MCP `_meta` fields are accepted as protocol metadata and ignored for authorization. Adding tenant, scope or approval claims there does not change discovery or call permissions.

## Tests and next slice

Run `npm run check`, Python unittest discovery, and `python scripts/check-parity.py`. The parity command includes `scripts/check-service-parity.py`: 33 shared HTTP cases, matching MCP transcripts, and actual mixed-language HTTP/stdio connections in both directions. Cases cover legitimate use, signature tampering, wrong operation/revision, revoked keys, wrong tenant/subject, forged facts, stale operations, malformed/duplicate JSON, transport bounds and error sanitization. Additional transport tests check lifecycle, notifications and framing. All credentials and keys in fixtures are explicitly public synthetic test material.

`python scripts/generate-service-contracts.py --check` checks OpenAPI/MCP contract copies and packaged discovery metadata. `python scripts/check-packages.py` now installs and exercises five npm tarballs and five Python wheels as standalone consumers.

The [stateful library foundation](persistence.md) supplies tenant/owner-scoped sessions, immutable nodes, atomic versioned updates and single-use checkpoints. The opt-in [workflow API](workflow-api.md) connects it to authenticated HTTP/MCP methods, exact-transition authorization, private token handoff and session-bound operation issuance/invalidation. Scan/decrypt/process require separate contracts and key-management decisions. Listing/cancellation/retention, complete proxy mediation, all eleven required PSP tools, Streamable HTTP MCP, independent security review and effectiveness evaluation remain future work.
