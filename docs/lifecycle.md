# Opt-in session lifecycle

Use `LifecycleStore` from `@psp-cdl/api-server/lifecycle` or
`psp_cdl_api_server.lifecycle`, with the existing SQLite backend and host
configuration. It extends WorkflowStore and adds a required
`authorizeRetention(actor, context)` / `authorize_retention(actor, context)`
callback. Use `LifecycleService(store, workflowHost)` with the existing HTTP or
MCP adapters. Imports open no listener or database.

The [draft profile](../specs/profiles/PSP-LIFECYCLE-0.1.md) defines the exact
authority, retention, expiry and compatibility boundaries.

| Call | Input | Result |
| --- | --- | --- |
| listSessions | after (null initially), limit (1–50), status | Bounded owner metadata and next exclusive cursor |
| cancelSession | requestId, sessionId, expectedVersion | Terminal cancelled status and incremented version |
| purgeSession | requestId, sessionId, expectedVersion | Purged status, version, cleaned count and more flag |

Wire names are `/v1/sessions/list`, `/cancel`, `/purge` under the same sessions
prefix, and `realflow.sessions.list/cancel/purge` in MCP. Listing uses
`sessions:read`; mutations require separate `sessions:cancel` / `sessions:purge`
scopes. All calls still require host authorization. Existing WorkflowService
does not enable these operations.

Cancel before cleaning a live running/waiting session. Completed and expired
sessions may be cleaned directly. Completed-session cancellation is rejected.
After the first purge page the workflow is unavailable; continue while `more`
is true using a new request ID and the returned version. Retry a lost response
with exactly the same request. Old checkpoints, handles and payload receipts
cannot revive the session. Lifecycle acknowledgements remain metadata-only.

Retention approval must check the entire proposed deletion and retained
tombstones against host policy and all CDL origins. False, exceptions and
truthy values other than true deny writes. Tombstones reserve IDs until epoch
retirement; if that retention is prohibited, reject durable use. Cleanup removes
logical record payloads; it does not promise erasure of disk pages or backups.
Hosts manage scheduling, holds, backup deletion and private checkpoint tokens.

Run the standard repository suites plus:

```sh
uv run --locked python scripts/generate-lifecycle-contracts.py --check
uv run --locked python scripts/generate-lifecycle-vectors.py --check
uv run --locked python scripts/check-lifecycle-parity.py
```

The shared cases run through HTTP/MCP dispatch in both languages; integration
checks also run actual HTTP/stdio peers, mixed-language restart/cleanup and
competing updates/resumes/cancellations. Release and conformance gates remain
unchanged. PostgreSQL, distributed cancellation and physical erasure remain
separate contracts.
