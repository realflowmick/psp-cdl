# ADR 0007: Authenticated workflow adapters

Status: experimental implementation; draft contract proposed for public review.

Expose six owner-scoped session/node/checkpoint methods through the existing HTTP and MCP transports by explicitly constructing `WorkflowService`. Add an optional store access guard that observes the exact planned transition and participates in the existing compare-and-write boundary. Reauthorize receipt reads separately. Keep `SecurityService` read-only and preserve published RFCs; the new [workflow service profile](../../specs/profiles/PSP-WORKFLOW-SERVICE-0.1.md) records the wire specialization and compatibility limits.

Keep host identity, approval, policy revision, persistence policy and data-release projection outside model arguments. Deliver checkpoint credentials through a private host callback; accept only checkpoint selectors on the wire. A delivery failure after commit is retryable with the same request ID and requires idempotent host delivery. No notification service or approval UI is introduced.

Issue bounded process-local operation handles and bind them to live durable session revision/node/policy/epoch. Fetch verification keys and evidence afresh on every resolution. A restart discards handles and requires fresh issuance, avoiding a new durable key/evidence store. Multi-worker routing/shared resolver and side-effect dispatch remain host or future-profile concerns.

Shared negative scenarios, actual mixed-language HTTP/MCP mutations, and runnable examples establish scoped behavior. Existing crash/replay tests continue to cover the persistence library. This work contributes to M3 and issue #5; it does not complete all eleven required PSP tools, prove complete mediation or establish production readiness.
