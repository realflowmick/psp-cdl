# PSP Lifecycle Profile 0.1

Status: **opt-in implementation draft**, not normative adoption. CC0-1.0.
This extension specializes PSP Core 3.2.0 §22.5.2 session listing and the
[persistence](PSP-PERSISTENCE-0.1.md) / [workflow](PSP-WORKFLOW-SERVICE-0.1.md)
drafts. It does not edit either published RFC or invent RFC-PSP-API.

## Admission and authority

Only `LifecycleStore` and `LifecycleService` enable these operations. Existing
security/workflow services do not advertise their routes. Hosts authenticate
identity, approve every operation, and approve the complete write set through
the existing persistence-policy callback. Literal true is required. Model text,
request IDs and cursors confer no authority. HTTP Bearer and MCP launcher
credentials use the existing transport boundaries. No credential is returned.

| Operation | POST route / MCP tool | Scope |
| --- | --- | --- |
| listSessions | /v1/sessions/list / realflow.sessions.list | sessions:read |
| cancelSession | /v1/sessions/cancel / realflow.sessions.cancel | sessions:cancel |
| purgeSession | /v1/sessions/purge / realflow.sessions.purge | sessions:purge |

Cancellation and purge are project extensions, not additional required RFC
tools. Exact wire contracts are in [OpenAPI](../../schemas/api/lifecycle-0.1.openapi.json)
and [MCP](../../schemas/mcp/lifecycle-tools-0.1.json). All fields are required;
unknown fields fail. Requests remain bounded to 1 MiB. Authentication is repeated
after host callbacks and before releasing results; host callbacks must have
bounded deadlines and externally coordinated policy authority.

## Listing

`{after: null | UUID, limit: 1..50, status}` returns `sessions` and `after`.
Statuses are `all`, `running`, `waiting`, `completed`, `cancelled`, `expired`.
The query partitions by recovery epoch, tenant and authenticated owner before
pagination. The keyset is ascending ASCII session UUID; `after` is exclusive.
An arbitrary valid cursor only skips the caller's own records. There is no total
count or cross-owner cursor lookup. Each row exposes only sessionId, version,
status, expiresAt and updatedAt, and requires host read authorization. Denying
any row denies the entire page. No application state, node/policy authority,
checkpoint secret or owner identifier is returned.

`expired` means `now >= expiresAt`, regardless of the retained status. Other
status filters exclude expired records; `all` includes them. Purged sessions
are never listed. Pages are live views, not an immutable multi-page snapshot:
concurrent inserts before a cursor may be missed and metadata may become stale.
Selection is bounded by returned rows, not a claim of constant database work.

## Cancellation and expiry

`{requestId, sessionId, expectedVersion}` changes running or waiting to
`cancelled`, including already expired running/waiting sessions. Completed,
cancelled and purged sessions reject new cancellation commands. Identical
retries return their historical acknowledgement after fresh authorization.
This does not grant scoped post-completion revocation (#46).

Session revision, cancellation and the minimal request receipt commit together.
Cancellation does not immediately remove state. The cancelled status and new
revision invalidate operation handles, old checkpoint use and competing writes.
Resume credentials may still exist in the host but cannot authorize a resume.
Old workflow reads/receipt recovery fail after cancellation; the lifecycle list
remains available. Cancellation cannot undo already completed external effects.
Without a shared OwnerCoordinator it cannot stop in-flight inference or external
read-only calls, but competing durable commits compare the session revision.
Distributed execution fencing remains #41.

Expiry remains strict at equality. No expiry worker or automatic deletion runs.
Hosts schedule explicitly authorized cleanup. Session expiry cannot be extended.

## Retention and bounded cleanup

Purge accepts the same three fields. A live running/waiting session must first
be cancelled. Completed, cancelled, expired or already purged sessions can be
cleaned. Each transaction replaces the session payload with a tombstone and at
most one related checkpoint/receipt payload with a tombstone. It returns
`{sessionId, version, status: "purged", cleaned: 0|1, more: boolean}`. When more
is true, submit a new request ID and the returned version for the next page.
Identical retries do not advance cleanup twice. Restart can continue from the
last acknowledged version, or recover that acknowledgement with the same ID.

The first page hides the session immediately, including any not-yet-scrubbed
receipt payloads. All state writers compare its revision and reject purged
status. Existing receipt recovery checks the live session before release.
Cleanup covers checkpoints, ordinary receipts, durable answer receipts and
prompt refresh records associated through sessionId or result.sessionId. Shared
node definitions and independent source/target copies in a redirect workflow
have their own retention decisions and are not recursively deleted.

Before every page, `authorizeRetention` / `authorize_retention` receives detached
copies of the original session, removed child record, proposed complete writes
and trusted current time. It must enforce retention deadlines, legal holds,
all originating CDL restrictions and permission to retain every tombstone and
minimal lifecycle acknowledgement. This is separate from transition and
persistence approval. Failure or non-true denies the whole transaction.

Tombstones retain tenant/owner IDs, record/session IDs, revisions and the old
request digest where present; session tombstones also retain purge time.
Lifecycle receipts retain the digest and metadata-only acknowledgement.
They are retained for the lifetime of the recovery epoch to prevent request-ID
reuse and resurrection. There is no automatic payload audit log. If required
anti-replay retention conflicts with no-persist/no-log or deletion obligations,
the host MUST reject durable use/cleanup and arrange separately reviewed epoch
retirement; metadata and hashes are not exempt from CDL. An external audit,
backup or token vault needs its own policy-governed retention/removal.

Deletion here is **logical payload removal**, not secure physical erasure of
SQLite pages, journals, snapshots, backups or host memory. Tombstone removal,
vacuuming, epoch retirement, delegated owners and node cleanup are unsupported.
Deploy lifecycle-aware libraries on every writer/reader using these records;
older persistence consumers do not implement the added statuses. The additive
SQLite record format remains schema 1; no baseline row is migrated on import.

## Validation

Shared scenarios cover authorization, ownership, scopes, strict pagination and
expiry, waiting/completed boundaries, duplicate commands, policy denial,
checkpoint invalidation and competing transitions. Paired transport checks,
mixed-language restart/cleanup and races, and injected transaction failure
exercise actual storage effects. They establish scoped draft behavior only;
full conformance, independent review and effectiveness remain pending.
