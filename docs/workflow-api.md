# Authenticated workflow API

The opt-in `WorkflowService` connects the reusable store to HTTP and MCP with host authorization. Its [draft profile](../specs/profiles/PSP-WORKFLOW-SERVICE-0.1.md), [OpenAPI contract](../schemas/api/workflow-0.1.openapi.json) and [MCP tool schemas](../schemas/mcp/workflow-tools-0.1.json) share requests and results across TypeScript and Python. This is an embeddable reference service; identity, approvals, operational management and customer experience belong to the embedding application.

Start with the runnable [TypeScript and Python example](../examples/workflow/README.md). It shows create â†’ save â†’ checkpoint â†’ denied resume â†’ host approval â†’ resume â†’ identical retry, without printing credentials or checkpoint tokens. The examples use disposable synthetic data, not production authorization policy.

## Construction and host callbacks

```ts
import { WorkflowService } from "@psp-cdl/api-server/workflow";
import { SessionOperations } from "@psp-cdl/api-server/operations";
import { createHttpServer } from "@psp-cdl/api-server/http";
import { McpServer } from "@psp-cdl/mcp-server";

// store is your WorkflowStore; host implements the callbacks below.
const operations = new SessionOperations(store, host);
const service = new WorkflowService(store, {
  ...host, resolve: (principal, id) => operations.resolve(principal, id)
});
const http = createHttpServer(service); // Still unbound; local-development helper.
const mcp = new McpServer(service, () => launcherCredential);
```

```python
from psp_cdl_api_server.workflow import WorkflowService
from psp_cdl_api_server.operations import SessionOperations
from psp_cdl_api_server.http import create_wsgi_app
from psp_cdl_mcp_server import McpServer

operations = SessionOperations(store, host)
host.resolve = operations.resolve
service = WorkflowService(store, host)
http = create_wsgi_app(service)
mcp = McpServer(service, lambda: launcher_credential)
```

The named variables are supplied by the embedding application. TypeScript callbacks may be async; Python uses synchronous callbacks and one SQLite connection per serving worker. The construction snippets do not supply an identity provider, start listeners or authorize real data. The existing `SecurityService` continues to expose only its two read-only tools.

| Host callback (TypeScript / Python) | Responsibility |
| --- | --- |
| `authenticate` | Validate credential, expiry/revocation/audience; return authenticated tenant, subject and scopes or null/None. |
| `now` | Trusted Unix-seconds clock. |
| `policyVersion` / `policy_version` | Current authoritative policy revision for the principal. |
| `authorize` | Approve the exact command, current record and proposed result; literal true/True only. Validate workflow transitions and trusted approval state. |
| `present` | Project permitted application state/node data into a public `view`. Control records are excluded before this callback. |
| `deliverCheckpoint` / `deliver_checkpoint` | Receive the committed checkpoint/token through a private, idempotent host handoff. Never log or forward the token to the model. |
| `resumeToken` / `resume_token` | Resolve a private token for this authenticated owner/checkpoint; return null/None if unavailable. This does not replace approval authorization. |
| `resolve` | Resolve read-only security operations; normally delegate to `SessionOperations`. Return null/None when no such operation exists. |
| `snapshot` (when using `SessionOperations`) | Build fresh verification keys, resource policies and evidence for the bound operation. Return `verification`, `resources`, and `expires`. |

Storage permission is still a separate required `WorkflowStore` callback. The access guard sees detached `{command, current, result, replay}` objects. `current` is the session used to plan a transition, the node/session for a read, or null for creation/receipt replay. A retry returns historical acknowledgement data with `replay: true`; explicitly authorize receipt disclosure. Guards must not perform external effects because a later revision conflict may reject the commit. Host callbacks remain trusted dependencies; database commits cannot serialize a separate identity/policy service's changes.

## Wire operations

All routes are POST with host-validated Bearer authentication. MCP credentials come from the trusted launcher, outside tool arguments. JSON request fields are camelCase in both languages; unknown fields fail. The `state`, next node and requested status are proposals, not authority.

| Route / MCP suffix | Scope | Request fields |
| --- | --- | --- |
| `sessions/create` / `sessions.create` | `sessions:write` | `requestId`, `nodeId`, `nodeVersion`, `expiresAt`, `state` |
| `sessions/get` / `sessions.get` | `sessions:read` | `sessionId` |
| `sessions/update` / `sessions.update` | `sessions:write` | `requestId`, `sessionId`, `expectedVersion`, `nodeId`, `nodeVersion`, `status`, `state` |
| `nodes/fetch` / `nodes.fetch` | `nodes:read` | `nodeId`, `nodeVersion` |
| `checkpoints/create` / `checkpoints.create` | `checkpoints:write` | `requestId`, `sessionId`, `expectedVersion`, `expiresAt` |
| `checkpoints/resume` / `checkpoints.resume` | `checkpoints:resume` | `requestId`, `checkpointId`, `state` |

Prefix HTTP routes with `/v1/` and MCP suffixes with `realflow.`. Publish immutable nodes with the trusted store's `putNode` API before creating sessions. Listing, cancellation, expiry deletion, delegated approval and node publication tools are not exposed.

Results have `{profile: "PSP-WORKFLOW-SERVICE-0.1", result: ...}`. Session results contain `sessionId`, `version`, `status` and host-projected `view`. Node results contain `nodeId`, `nodeVersion` and `view`. Checkpoints return `checkpointId`, `sessionId`, `sessionVersion`, `expiresAt`; they contain neither a resume token nor an automatically generated link. The service excludes owner and policy control records from outputs.

Updates use optimistic versions. On 409, read fresh state and obtain fresh host authorization. On a lost response, reuse the exact request ID and arguments. Projection/delivery can fail after commit; identical retry recovers the acknowledgement and retries private delivery. `CHECKPOINT_DELIVERY_FAILED` is 503, not a rollback. A changed policy revision can make a retry conflict; reconcile the live session in the trusted host instead of silently issuing a new mutation. Tokens must remain recoverable through the host until expiry, including acknowledgement retries.

## Operation snapshot lifecycle

From a trusted host, call `operations.issue(principal, sessionId, expires)` to obtain a new opaque operation ID. The host must already have authenticated the principal and authorized the intended action. The registry authorizes reading the session and binds its version, node, policy and recovery epoch. Pass that ID to the existing verification/policy endpoints. Call `operations.revoke(operationId)` to revoke it explicitly.

`snapshot` executes afresh on resolution, including current key revocation and operation-specific evidence. It must bind the intended tool/action, input data, recipient, capabilities and provenance to the operation ID in the host's own records. The resolver adds signed context bindings for tenant, operation, policy, session/revision and node/version, and rechecks live session state after snapshot construction. State changes and external host policy changes invalidate old handles. A read-only allow result never authorizes later dispatch.

Handles are bounded process-local state, default capacity 1024, with no automatic durable payload copy. Expired handles are pruned on issuance. Restart requires fresh issuance; service replicas must route to the issuing registry or supply a future shared resolver. Durable sessions/checkpoints remain in the existing backend. Keep the registry in a single worker; it is not a distributed coordination service.

## Validation and remaining work

41 shared scenarios cover denied reads/transitions/storage, tenant and owner isolation, strict fields, credential/policy changes during authorization, competing updates, detached callbacks, retry authority, checkpoint delivery failure and retry, expiry and stale operation bindings. The parity script exchanges actual mutations over HTTP and MCP stdio in both language directions. Existing store tests still cover abrupt exits, portable database/token interchange and concurrent commit/resume races.

Run the full repository checks and `uv run --locked python scripts/check-workflow-parity.py`. Contract/vector generators support `--check`. Transport limits and deployment responsibilities remain in the [service guide](service-api.md). The libraries remain experimental; full M3 coverage, graph execution, proxy enforcement, PostgreSQL, outbox dispatch and independent security review remain pending.

The opt-in [session lifecycle draft](lifecycle.md) adds owner-scoped listing, cancellation and bounded policy-approved payload cleanup in both languages. Checkpoint/operation invalidation, replay tombstones and retained metadata have explicit contracts. This #37 working slice requires review; it does not complete M3 or claim physical erasure.
