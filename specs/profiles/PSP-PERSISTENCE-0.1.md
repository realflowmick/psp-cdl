# PSP Persistence Profile 0.1

Status: draft, experimental host-library contract. License: CC0-1.0.

This profile specializes PSP Core 3.2.0 §22 without changing its published text. It defines durable state operations, not public HTTP/MCP methods or permission to execute a tool. The existing read-only service profile remains unchanged.

## Authority and data

Only a trusted host may call the workflow store. The host MUST authenticate the caller, authorize the operation and transition, and derive `tenantId` and `subjectId` outside model-controlled arguments. This draft supports owner-only sessions/checkpoints. Delegated approval is unsupported. A submitted `approved` value does not establish authority.

The host MUST supply a persistence-policy callback. It receives the complete proposed write set, including receipts and metadata, before any record is written. Only literal true permits storage. Evaluate all originating CDL restrictions and storage/logging obligations first. Encryption, hashing and calling a record metadata do not automatically exempt it from restrictions. Denied storage MUST leave all records unchanged. The store itself does not infer policy from arbitrary state JSON. Hosts MUST separately authorize reads, logs, backups and retention.

State and node definitions are bounded portable JSON, using the existing core codec and JCS. Each command and write set is limited to 1 MiB. Signed markup remains an exact string or a core document object; storage MUST NOT rewrite signed bytes. No private signing key, raw authentication credential or raw resume token is stored by the library. Application state must not contain those secrets either; this is a host obligation.

## Operations

`putNode`, `getNode`, `createSession`, `getSession`, `updateSession`, `createCheckpoint` and `resumeCheckpoint` are host commands. Unknown fields are rejected. Mutating session/checkpoint commands require a host-scoped `requestId`. UUID v4 session and checkpoint IDs are generated inside the library. Node identity is `(tenantId, nodeId, nodeVersion)` and is immutable. Republishing identical JSON is idempotent; replacing it conflicts.

Sessions bind owner, current node/version, policy version, expiry and a monotonically increasing version. Updates use an expected version. Running sessions may advance or complete; completed sessions are terminal. Checkpoint creation changes running to waiting and increments the version. Only consuming its checkpoint can leave waiting. Resumption changes waiting to running, replaces host-approved state, and increments the version. Checkpoints bind the exact waiting version, owner and expiry. Session/node/policy changes require fresh authorization by the host.

All timestamps are nonnegative safe integers in Unix seconds. `now >= expiresAt` is expired, with no grace period. Checkpoint expiry MUST NOT exceed session expiry. A commit checks expiry after obtaining write serialization and before committing. Backends use a trusted host clock; deployment must prevent clock rollback. Session lifetime cannot be extended by an update in this draft.

## Atomicity, retries and replay

The backend MUST atomically compare every read revision and apply the entire write set, including the request receipt. Checkpoint consumption, the corresponding session transition and receipt insertion are one transaction. Failed comparisons or failed writes MUST publish none of them. Concurrent state transitions have at most one winner per expected version. All queries and writes are partitioned by external recovery epoch and tenant; subject checks are performed on sessions, checkpoints and receipts.

A receipt binds the authenticated owner/request ID to the SHA-256 digest of the complete canonical command and the original result. An identical retry returns the original result until its expiry; reuse for a different command fails. A retry result is historical acknowledgement, not a new transition or a current authorization. Concurrent identical requests may return the winner's receipt; other conflicts require a fresh host read. Receipts, session IDs and consumed checkpoints are not deleted/reused by this draft. No automatic pruning or claims of unlimited retention are made.

Resume tokens have form `checkpoint-uuid.base64url(mac)` with a 32-byte HMAC-SHA256 MAC over JCS `["PSP-PERSISTENCE-0.1", epoch, tenantId, subjectId, checkpointId]`. A host supplies at least 32 bytes of random secret material outside storage/model input. Only SHA-256 of the token is recorded. Token reconstruction permits safe retry of checkpoint creation without recording its raw token. Verification checks the current secret and stored digest; all service instances/languages in one epoch must use the same secret. Use a new epoch when rotating this secret. Possession alone does not bypass owner authorization. Duplicate resumption under a new request ID fails; an identical request ID is only an acknowledgement retry.

The recovery epoch is authoritative configuration outside the restored database. After rollback/backup restore, the host MUST fence old writers, change epoch and secret, and explicitly reauthorize/import any retained sessions. Reusing an old epoch can resurrect consumed tokens and old receipts. This adapter does not automate disaster recovery or prevent a compromised database administrator from modifying state.

## Adapter contract and limits

`AtomicBackend` provides partitioned reads and atomic compare-and-write batches. Revisions begin at one and increase by one on replacement; absent records are compared using null. Every write must have an explicit comparison. Duplicate keys or unmatched writes are invalid. Callers must not access this low-level interface from model or network input. TypeScript supports asynchronous adapters; Python uses a synchronous protocol suitable for a worker.

The SQLite reference uses one local file, a versioned shared schema, rollback journaling, FULL synchronization and `BEGIN IMMEDIATE`. It rejects in-memory/URI paths and databases belonging to an unknown schema. It performs no external I/O within a transaction. Normal SQL failure rolls back; a lost acknowledgement after commit is recovered by retrying the same request ID. Lock contention returns `STORE_BUSY`. Filesystem/hardware durability and host access controls remain deployment responsibilities.

PostgreSQL and other adapters must pass the same transaction, restart, race, isolation and serialization tests. A cache, uncoordinated JSON files or an object store alone is not a conforming transaction adapter.

Database atomicity does not make external tool effects atomic. The RFC's illustrative `execute_node()` transaction cannot undo a remote call. A future dispatch profile must specify an outbox/intent, recipient idempotency and reconciliation; no exactly-once external-execution claim is made here. Session-bound operation snapshot issuance/invalidation, list/pagination, cleanup, public mutation tools, delegated approval and dispatch remain separate work. A host integrating the existing security resolver must compare live session version, node and policy bindings; stored verification results are not permits.
