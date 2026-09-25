# Persistence: requirements, options and reusable API

The stateful foundation is implemented as reusable TypeScript and Python libraries. Both use the same draft [persistence profile](../specs/profiles/PSP-PERSISTENCE-0.1.md), [command schema](../schemas/persistence/commands-0.1.schema.json) and [SQLite format](../schemas/persistence/sqlite-0.1.sql). The storage interface is replaceable. SQLite is the reference default; PostgreSQL is the recommended next adapter for deployments with multiple service instances. No database service is provisioned and there is no RealflowCloud account dependency.

## What must survive a restart

| Information | Why it matters | Current implementation |
| --- | --- | --- |
| Immutable node definitions and their versions | Restore the exact workflow definition that was authorized | Tenant-scoped node records; different content at an existing version conflicts |
| Session owner, state, current node, policy version, expiry and revision | Recover workflow progress and prevent lost updates | Owner-scoped records, JSON round trips and compare-and-write updates |
| Checkpoint binding, expiry and consumed state | Prevent two resumes from advancing the same workflow | Consumption and session transition commit together |
| Request digest and original acknowledgement | Recover after a commit succeeds but the response is lost | Owner-scoped idempotency receipts in the same transaction |
| Fresh operation/policy/evidence bindings | Stop a previously allowed operation executing after state changes | [Session-bound resolver](workflow-api.md) rechecks live state; dispatch remains pending and read-only results are not permits |
| Pending external effects and outcomes | Recover across remote calls without blindly repeating them | Future outbox, recipient idempotency and reconciliation |
| Audit and retention records | Explain authorized decisions within data-handling limits | Future policy-governed audit/cleanup; no automatic payload logging |

Durable storage is optional for pure parsing, signature checks and policy evaluation. An embedding application can provide the store once for proxies, MCP/API servers and future model hosts. Parsers and models do not need database connections. Durable replay protection belongs to the authoritative host; model context is not that authority.

## Backend choices

| Option | Best fit | Tradeoff and project support |
| --- | --- | --- |
| **SQLite** | Local development, reference demos, a service on one machine | Implemented in both languages, no database server. One writer at a time; bounded contention can return `STORE_BUSY`. Use a local persistent filesystem, not a shared network drive. |
| **PostgreSQL** | Multiple service instances, substantial concurrent writes, a centrally operated service | Recommended next adapter. Requires provisioning, migrations, access control, backups and monitoring. Atomic conditional updates/row locking or serializable transactions must preserve the same tests; serialization failures require whole-transaction retry. |
| **Existing host database** | Integrating the standards into another product | Implement `AtomicBackend` and run the same suite. It must atomically compare and write all involved records, including absent keys; plain CRUD or an eventually consistent read/write sequence is insufficient. |
| **Redis/cache** | Caching immutable nodes, rate limiting and other expendable acceleration | Optional future component. This project does not rely on a cache as the authority for consumed tokens or session revisions. A primary adapter would need explicit durability, failover and recovery guarantees plus conformance tests. |
| **Object storage** | Large payloads whose policies permit storage | Future complement to a transactional database. Put permitted blobs separately and bind references/digests in a transaction; handle orphan cleanup and retention. Not a replacement for the checkpoint transaction. |
| **Memory** | Unit tests and disposable experiments | A future test adapter can implement the interface, but cannot claim restart persistence or durable replay protection. |

SQLite's official [usage guidance](https://www.sqlite.org/whentouse.html) describes its local-storage and single-writer tradeoffs. Its [WAL documentation](https://www.sqlite.org/wal.html) requires same-machine coordination; this initial adapter instead uses rollback journaling and FULL synchronization for a simple common baseline. PostgreSQL's [transaction isolation documentation](https://www.postgresql.org/docs/current/transaction-iso.html) explains concurrency guarantees and transaction retries. Redis offers configurable [persistence mechanisms](https://redis.io/docs/latest/operate/oss_and_stack/management/persistence/); the reference implementation does not assume their defaults satisfy this project's replay guarantees.

The recommended sequence is SQLite now, then a PostgreSQL adapter against the same host contract. Deployments can select either without changing the PSP/CDL codecs or workflow command semantics. An eventual PostgreSQL adapter should retain JCS text for canonical records; do not assume database JSON reserialization preserves signed bytes.

## Data handling, secrets and recovery

Persistence permission must be checked **before the write**, including the session state copied into an idempotency receipt. `no-persist`, `no-log`, collection restrictions, origin-specific grants, retention and deletion rules are not bypassed by encryption or by calling something metadata. A hash can still be governed data. When permitted control state cannot be separated from prohibited content, reject durable execution or use a separately specified ephemeral workflow; do not silently persist it for recovery. This slice has no automatic expiry deletion, checkpoint cancellation or session lifetime extension. An expired waiting checkpoint cannot resume; hosts need a future reviewed cancellation/restart flow.

The host supplies `authorizePersistence(actor, writes)` / `authorize_persistence(actor, writes)`. It must evaluate the complete candidate write set using trusted provenance and applicable CDL facts; the library cannot infer those facts from arbitrary JSON. It receives detached copies and must return literal `true` / `True`. Failure or any other result denies the write. Authentication, permission to transition, reads, logs, backups and downstream payload stores require their own host enforcement. The callback must not perform external side effects: a later revision conflict can still prevent the commit.

Resume tokens are deterministic HMACs using a host-managed secret, bound to recovery epoch, tenant, owner and checkpoint UUID. Only token hashes are stored; retrying checkpoint creation reconstructs the same token. Load the same random secret (at least 32 bytes) in every instance in an epoch. Keep it in an injected secret store/environment credential mechanism, outside model input and the workflow database. Use separate keys for PSP signing; private signing/encryption keys also belong in a host secret manager/KMS. No identity provider or secret-manager vendor is required by the libraries.

Protect the database directory and its journal files with host filesystem permissions and appropriate volume encryption. The adapter does not configure encryption, backups or retention. Backups and logs are additional copies subject to policy. Do not copy an actively written database as an ad hoc backup; use a consistent database backup procedure and test restores.

**A database restore is a security event.** An older backup can restore an unconsumed checkpoint. Before accepting traffic, fence old writers, change the external recovery epoch and resume secret, and explicitly reauthorize/import retained sessions. Old records are inaccessible in the new epoch; they are not erased. Merely reopening a restored file using the old configuration does not prevent replay. The epoch must come from authoritative configuration outside the restored database, and every active instance must use the new configuration. Prevent host clock rollback as well; timestamps are Unix seconds and expiry is strict at equality.

Atomic database transitions are not exactly-once external tool execution. A remote email/API call cannot be rolled back by SQLite/PostgreSQL. Future dispatch must atomically record an intent with the session transition, use recipient idempotency where available, and reconcile ambiguous outcomes. Tools without that support need explicit recovery rules.

## Using the host library

| Interface | TypeScript | Python |
| --- | --- | --- |
| Domain store and adapter contract | `@psp-cdl/api-server/persistence`: `WorkflowStore`, `AtomicBackend`, `WorkflowCommand`, `StoreError` | `psp_cdl_api_server.persistence`: `WorkflowStore`, `AtomicBackend`, `StoreError` |
| Explicit SQLite adapter | `@psp-cdl/api-server/sqlite`: `SqliteBackend` | `psp_cdl_api_server.sqlite`: `SqliteBackend` |

The Node adapter uses built-in `node:sqlite`, available without a flag from Node 22.13; prefer the project's Node 24 runtime. See the [Node SQLite API](https://nodejs.org/download/release/v22.13.1/docs/api/sqlite.html). Python uses standard-library [sqlite3](https://docs.python.org/3.12/library/sqlite3.html). Node SQLite calls block the event loop; put this adapter in a worker for latency-sensitive servers. Python uses one connection per worker. Importing the root package opens no database and does not load the SQLite adapter. Constructing the adapter explicitly opens/initializes the supplied local file; its parent directory must already exist.

```ts
import { WorkflowStore } from "@psp-cdl/api-server/persistence";
import { SqliteBackend } from "@psp-cdl/api-server/sqlite";

// Supplied by your authenticated host, outside model-controlled arguments:
const backend = new SqliteBackend(databasePath, recoveryEpoch);
const store = new WorkflowStore(backend, {
  resumeSecret,
  authorizePersistence: (actor, writes) => hostAllowsPersistence(actor, writes)
});
try {
  const node = await store.execute(actor, {
    action: "putNode", nodeId: "entry", nodeVersion: "1", definition: nodeDocument
  });
  const session = await store.execute(actor, {
    action: "createSession", requestId: requestId,
    nodeId: "entry", nodeVersion: "1", policyVersion: "policy-1",
    expiresAt: hostExpiry, state: initialWorkflowState
  });
  // Save session.sessionId in the host; use expectedVersion for transitions.
} finally { backend.close(); }
```

```python
from psp_cdl_api_server.persistence import WorkflowStore
from psp_cdl_api_server.sqlite import SqliteBackend

backend = SqliteBackend(database_path, recovery_epoch)
store = WorkflowStore(backend, resume_secret=resume_secret,
                      authorize_persistence=host_allows_persistence)
try:
    node = store.execute(actor, {
        "action": "putNode", "nodeId": "entry", "nodeVersion": "1",
        "definition": node_document,
    })
    session = store.execute(actor, {
        "action": "createSession", "requestId": request_id,
        "nodeId": "entry", "nodeVersion": "1", "policyVersion": "policy-1",
        "expiresAt": host_expiry, "state": initial_workflow_state,
    })
finally:
    backend.close()
```

These are host integration snippets: the named variables and policy callback must be provided by the application. Do not replace the callback with an unconditional allow for governed data. `actor` is exactly `{tenantId, subjectId}` derived from host authentication, and commands/records use the same camelCase JSON field names in both languages. This API does not accept bearer credentials or authenticate caller-supplied actors.

| Command | Additional required fields |
| --- | --- |
| `putNode` | `nodeId`, `nodeVersion`, `definition` |
| `getNode` | `nodeId`, `nodeVersion` |
| `createSession` | `requestId`, `nodeId`, `nodeVersion`, `policyVersion`, `expiresAt`, `state` |
| `getSession` | `sessionId` |
| `updateSession` | `requestId`, `sessionId`, `expectedVersion`, `nodeId`, `nodeVersion`, `policyVersion`, `status` (`running` or `completed`), `state` |
| `createCheckpoint` | `requestId`, `sessionId`, `expectedVersion`, `expiresAt` |
| `resumeCheckpoint` | `requestId`, `checkpointId`, `resumeToken`, `state` |

The host must authorize each command before `execute`, including approval and the chosen next state; no field inside `state` confers permission. Commands replace complete state objects, using the shared core JSON codec. A session response contains owner, UUID, version, current node/version, policy revision, state, status and timestamps. A checkpoint response contains its UUID, session binding, expiry and resume token. Tokens must not be logged or placed in model context. A same-request retry returns the original acknowledgement, even if newer session state exists; read the session again before making decisions.

`AtomicBackend.read(tenantId, key)` returns an isolated record or null/None. `commit(tenantId, checks, writes, expiresAt)` atomically compares all key revisions and applies the writes, returning false on a conflict. A null comparison means the key must not exist. Revisions start at one and increase by one; writes without matching comparisons are rejected. The epoch partitions every record. An implementation must recheck expiry while holding write serialization and roll back the entire batch on error. TypeScript methods can return promises for network-backed adapters; Python's protocol is synchronous.

Common stable error codes are `NOT_FOUND` (including wrong owner/tenant), `STATE_CONFLICT`, `NODE_CONFLICT`, `IDEMPOTENCY_CONFLICT`, `INVALID_TRANSITION`, `CHECKPOINT_CONSUMED`, `INVALID_TOKEN`, `EXPIRED`, `PERSISTENCE_DENIED`, `STORE_BUSY`, `STORE_FAILURE` and `UNSUPPORTED_SCHEMA`. A `STORE_BUSY` retry may reuse the same request ID after bounded backoff; a stale version needs a fresh read and authorization. Never retry a non-idempotent external effect merely because storage returned an error.

## Evidence and next work

An optional `OwnerCoordinator` can now be supplied to `WorkflowStore`. Every mutation reserves the tenant/subject until completion, returning `STATE_BUSY` if another coordinated write or gate is active; reads remain available. All stores for that owner must share the same coordinator. The [MCP dispatch gate](mcp-dispatch.md) requires it and holds a reservation through read-only endpoint completion and output checks. This is process-local exclusion, not distributed locking or durable effect dispatch. Stores without a coordinator retain the original compare-and-write behavior. Workflow HTTP maps `STATE_BUSY` to 409.

The separately opt-in [durable loop profile](llm-durable.md) adds private
`commitTurn` / `getTurn` commands when `durableTurns: true` (`durable_turns=True`)
is enabled. A turn writes session revision and answer receipt in the existing
transaction and SQLite format. Completion adds terminal state and a top-level
lockdown record. All write-set policy checks still apply, including retained
policy metadata and the answer. This does not add HTTP/MCP operations or change
the baseline commands; recovery requires a fresh authenticated disclosure decision.

Both implementations execute 42 shared command cases and direct tests for policy denial, bounds, secret/epoch changes, SQL-failure rollback and schema checks. `python scripts/check-persistence-parity.py` exchanges actual files and token/receipt values in both directions, recovers from abrupt exit before/after commit, and synchronizes Node/Python competitors before commit to test updates, competing resumes and identical retries. These checks establish scoped behavior under the tested failures; they are not power-loss certification or independent security review.

The library is available to host applications and the opt-in [authenticated workflow service](workflow-api.md). Its store access guard authorizes exact transitions before commit and reauthorizes historical receipt reads. The workflow adapters add private checkpoint-token handoff, projected results, session-bound operation invalidation and real mixed-language transport tests. Controlled cancellation/listing/cleanup, PostgreSQL and dispatch outbox recovery remain pending, along with publication, production readiness and complete PSP conformance.

The opt-in [session lifecycle draft](lifecycle.md) adds owner-scoped listing, cancellation and bounded policy-approved payload cleanup in both languages. Checkpoint/operation invalidation, replay tombstones and retained metadata have explicit contracts. This #37 working slice requires review; it does not complete M3 or claim physical erasure.
