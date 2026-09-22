# ADR 0006: Portable durable workflow state

Status: experimental implementation; SQLite is the reference default pending deployment-specific selection.

The author requested the next implementation step and a discussion of persistence options. Add a reusable state library behind `AtomicBackend`, within each existing `api-server` package. Keep core/CDL parsing independent of I/O and keep storage separate from HTTP/MCP dispatch. A host can reuse it in proxies, servers or model integrations. The [persistence guide](../persistence.md) records the choices and operational requirements; the [draft profile](../../specs/profiles/PSP-PERSISTENCE-0.1.md) records new semantics without rewriting PSP §22.

Implement SQLite first because a checkout should run without a hosted service, credentials or sponsor account. Both languages open the same versioned format. Use built-in Node/Python SQLite support, local files, rollback journaling, FULL synchronization and bounded locking. An asynchronous-compatible TypeScript adapter contract leaves room for PostgreSQL; a generic CRUD repository would not express the required cross-record atomicity. PostgreSQL is recommended for multiple server instances and remains unimplemented.

Use optimistic revision comparisons and an atomic write batch for session changes, checkpoint consumption and retry receipts. An explicit host policy callback authorizes the complete candidate storage set, including copied state and metadata. HMAC-derived owner/epoch-bound resume tokens support retry without storing raw tokens. Recovery epoch and secret live outside the restored database. This does not authenticate callers, authorize model-selected transitions, automate backup recovery, or make remote tool effects atomic.

The implementation supplies 42 shared cases, injected SQL rollback tests, actual two-way database/token interchange, abrupt-exit recovery and synchronized mixed-language races. Public mutation APIs, operation-snapshot issuance/invalidation, listing/cancellation/cleanup, outbox dispatch, full M3 coverage and independent security review remain open. Existing read-only HTTP/MCP contracts remain unchanged and advertise no unfinished methods.
