# PSP Workflow Service Profile 0.1

Status: draft, experimental opt-in contract; proposed for public review. License: CC0-1.0.

This profile specializes PSP Core 3.2.0 §22, including the checkpoint subsection headed "21.5.4" in the published text. It builds on [Persistence 0.1](PSP-PERSISTENCE-0.1.md) and the authentication, HTTP and MCP transport rules of [Service 0.1](PSP-SERVICE-0.1.md). Neither published RFC semantics nor the existing read-only service profile are replaced. RFC-PSP-API remains unavailable; these are project-owned draft contracts, not a commercial SaaS API.

## Operations and authority

An embedding host explicitly selects `WorkflowService`. `SecurityService` alone MUST NOT advertise or route workflow methods. Shared [HTTP](../../schemas/api/workflow-0.1.openapi.json) and [MCP](../../schemas/mcp/workflow-tools-0.1.json) contracts define six operations:

| Operation | POST route | MCP tool | Required scope |
| --- | --- | --- | --- |
| Create session | `/v1/sessions/create` | `realflow.sessions.create` | `sessions:write` |
| Read session | `/v1/sessions/get` | `realflow.sessions.get` | `sessions:read` |
| Update session | `/v1/sessions/update` | `realflow.sessions.update` | `sessions:write` |
| Fetch node version | `/v1/nodes/fetch` | `realflow.nodes.fetch` | `nodes:read` |
| Create checkpoint | `/v1/checkpoints/create` | `realflow.checkpoints.create` | `checkpoints:write` |
| Resume checkpoint | `/v1/checkpoints/resume` | `realflow.checkpoints.resume` | `checkpoints:resume` |

Requests use the persistence library's camelCase field names, omit `action`, and MUST NOT supply tenant, subject, policy revision, credentials, resume tokens or authorization evidence. Unknown fields fail. IDs supplied by callers are lookup selectors, never authority. State JSON and requested node/status changes are untrusted proposals. Node publication stays a trusted-host operation.

The service MUST derive tenant/subject from validated credentials, enforce scope on every request, pin identity across transport reauthentication, and independently enforce store ownership. `policyVersion` comes from a host callback. The host MUST authorize each read, transition and receipt read against detached copies of the exact command, current record (or null) and proposed result. Only literal true permits access; exceptions and truthy values deny. Checkpoint creation/resumption additionally requires the live host policy revision to match the session's revision. Policy refresh/reconciliation is a host responsibility; the service does not execute the workflow graph or treat a submitted `approved` field as approval.

For new mutations the access guard runs after storage-policy evaluation and before the atomic commit. All read revisions remain in the compare-and-write batch, so a competing update after authorization MUST cause the whole write to fail. The service rechecks credentials, scope and applicable policy revision after the authorization callback. External policy/identity authorities are not in the database transaction: hosts MUST provide appropriate synchronization or bounded validity for their decisions. This profile supplies no atomic cross-system revocation or tool-dispatch permit.

## Retries, data release and checkpoint credentials

Identical request IDs use Persistence 0.1 receipts. Receipt reads MUST be authorized again with `replay: true` and `current: null`; the result is the original acknowledgement, not current session state or a newly approved transition. A host may deny access to a historical receipt. Reusing a request ID with changed arguments or a different host policy revision fails with `IDEMPOTENCY_CONFLICT`. Callers MUST retain request IDs across transport failures and read live state before subsequent decisions.

Session and node output contains identifiers/revisions plus a `view` explicitly projected by the host's `present` callback. It receives only application state or node definition, never store control records. The host MUST enforce data-release policy, preserve provenance and exclude secrets from stored application data and returned views. This callback is required; there is no default unrestricted projection. Projected data remains untrusted input to an LLM. Projection errors can occur after a mutation committed; identical retry is the recovery mechanism.

Checkpoint creation returns its identifier, session/version binding and expiry. It MUST NOT return a raw resume token in HTTP/MCP output. After the commit, the service passes the token to the authenticated host's private `deliverCheckpoint` callback. Delivery MUST be idempotent by tenant/owner/checkpoint; it may run again on receipt retry. Failure returns `CHECKPOINT_DELIVERY_FAILED` (503) and does not undo the committed checkpoint. The host MUST retain/recover private token access for authorized retries until the relevant expiry. This is a private handoff, not an implementation of notifications, approval UI or guaranteed external delivery.

Resumption takes checkpoint ID, request ID and proposed state. A trusted `resumeToken` callback supplies the token outside request/model input; a separate transition authorization callback MUST validate any required approval. Possession or retrieval of the token alone grants no permission. Store ownership, expiry, single-use consumption and receipt atomicity still apply. Delegated approvers are unsupported.

## Session-bound operation handles

`SessionOperations` is a trusted-host resolver for the existing security service. It issues unpredictable UUID v4 handles bound to tenant, subject, session ID/revision, active node/version, policy revision, external recovery epoch and expiry. Issuance requires an authorized read of a running session under the current host policy; expiry MUST NOT exceed session expiry. Issuance and revocation are not model-callable HTTP/MCP tools.

Every resolution MUST check ownership, expiry, live session binding and current host policy. It MUST fetch keys, capability provenance and operation evidence anew through the host snapshot callback, then recheck the session binding after that callback. Snapshot signature context MUST bind tenant, operation, policy, session/revision and node/version. A changed binding fails with `STALE_OPERATION`; missing or other-owner handles return `NOT_FOUND`. A host can explicitly revoke a handle. The host MUST validate operation-specific inputs/evidence and refresh key revocation state; the resolver cannot infer provenance from arbitrary JSON.

The reference registry is bounded process-local control state (default 1024 handles). Capacity exhaustion fails with `OPERATION_CAPACITY`; expired entries may be pruned at issuance. Restart drops all handles and requires fresh issuance. Sessions/checkpoints and retry receipts remain durable. Multiple workers need host routing to the issuing registry or a separately specified shared handle backend. No durable operation registry or cross-worker handle replication is claimed.

These read-only results are observations at resolution, not execution tickets. Concurrent state can change immediately afterward. Future dispatch MUST validate live authority at the side-effect boundary and mediate the actual tool call.

## Limits and evidence

This slice retains Service 0.1 transport limits, duplicate-aware JSON parsing, scope-filtered discovery and generic error sanitization. Persistence conflicts/expiry use 409, denied authority/storage use 403, unavailable stores/delivery use 503, and unexpected backend errors use 500 without private details. Owner-only scope, bounded JSON and the SQLite schema are unchanged. Checkpoint resume links, notifications, session listing/cancellation/retention, scan/decrypt/process, full graph execution, PostgreSQL and external-effect outbox dispatch remain unsupported.

Shared workflow scenarios test persistence invariants through the authenticated adapters; real mixed-language HTTP/stdio exchanges test transport interoperability. These checks are scoped evidence, not full PSP conformance, production readiness, independent review or measured security effectiveness.
