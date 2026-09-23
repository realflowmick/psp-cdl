# Automatic prompt refresh

`RefreshingLlmLoop` is an explicit extension of the [durable loop](llm-durable.md)
under [PSP Prompt Refresh 0.1](../specs/profiles/PSP-PROMPT-REFRESH-0.1.md).
It obtains host-approved, signed replacements at inference boundaries and stores
the accepted content version and turn counter across process restarts. The
original buffered and durable classes still reject refresh attributes.

## Adoption and host callbacks

Enable `durableTurns: true` and `promptRefresh: true` on the TypeScript
`WorkflowStore`, or `durable_turns=True, prompt_refresh=True` in Python. Share its
`OwnerCoordinator` with the dispatch gate. Keep the durable loop's host callbacks,
identity scopes, current policy checks and explicit lockdown configuration.

```ts
import { RefreshingLlmLoop } from "@psp-cdl/llmproxy";

const loop = new RefreshingLlmLoop(store, gate, host, provider, {
  postCompletion: "lockdown"
});
const answer = await loop.run(credential, sessionId, { message: userText }, {
  requestId, expectedVersion, deadline, cancelled, maxSteps: 4
});
```

```python
from psp_cdl_llmproxy import RefreshingLlmLoop

loop = RefreshingLlmLoop(store, gate, host, provider, {"postCompletion": "lockdown"})
answer = loop.run(credential, session_id, {"message": user_text}, {
    "requestId": request_id, "expectedVersion": expected_version,
    "deadline": deadline, "cancelled": cancelled, "maxSteps": 4,
})
```

These callbacks supplement `DurableHost`:

| TypeScript / Python | Host responsibility |
| --- | --- |
| `refresh` | `(principal, binding, request)` returns a fresh signed SYSTEM text envelope. The request contains `session_id`, `current_version`, `trigger`, and `turn_count`. |
| `authorizeRefresh` / `authorize_refresh` | `(principal, binding, previous, candidate)` returns literal `true` only when the proposed instructions are compatible with authoritative policy and application state. `previous` is accepted metadata or `null` for initialization. |
| `auditRefresh` / `audit_refresh` | `(principal, event)` accepts an event by returning literal `true`. Events carry a profile, signal, binding, time and version/digest or failure code; they exclude raw prompts, user text and private callback errors. |

`prompt` remains the initial/rebinding callback. Its binding additionally contains
`refresh: {current_version, trigger, turn_count}`; initialization also includes
`session_id`. For `trigger: "binding"`, reissue the accepted instructions with
the current signed `promptContext` / `prompt_context`. The content version and
digest must match durable metadata. This path cannot install changed instructions.
Every new invocation rechecks signatures, identity, policy and audit acceptance.
The provider receives the verified text, ordinary messages and permitted tools;
it receives neither credentials nor authoritative refresh/session metadata.

## Triggers and version continuity

Include supported directives in the envelope's signed `attributes`, alongside
the required prompt context:

```json
{
  "refresh-policy": "interval|expiration",
  "refresh-interval": "10",
  "refresh-grace": "300"
}
```

Omitting the policy selects `expiration`; omitting grace selects 300 Unix seconds.
Interval must be a positive canonical integer string; grace may be zero. A
refresh is due at `now >= expires - grace`, or before the next inference after
N committed user/final-answer exchanges. Only successful atomic turn commits
increment the counter. Tool calls and intermediate inference steps do not.
Successful refresh resets it to zero even if that turn later fails.
Actual expiration requires replacement even under interval-only policy.

SemVer precedence rejects lower versions, including prerelease rollbacks, without
converting large version components to floating point. Build metadata and an
optional `v` prefix do not change precedence. Equal-precedence versions must keep
normalized text, trust, priority and directives unchanged. Any version increase,
including major changes, needs host compatibility approval. A replacement must
be newly issued, have a later timestamp than the accepted envelope and expire
beyond its new grace window. A cold start with no accepted metadata rejects an
already expired prompt; expired content cannot choose its own refresh controls.

Before another inference, the loop replaces the system message and checks the
entire transcript under current policy. The host must retain the origins and
restrictions of earlier data. If a prompt expires during a provider or tool
callback, the pending result is withheld. A later invocation may refresh, but
the loop does not replay that pending result under different instructions.

## Persistence, recovery and audit

The [private store schema](../schemas/persistence/prompt-refresh-0.1.schema.json)
defines `getPromptState`, `putPromptState`, and `commitRefreshedTurn`. These add
no HTTP/MCP methods. Metadata contains version, digest, directives, issuance,
expiration and counters; raw envelopes, prompts and signing keys are not stored.
The record uses a separate receipt key namespace in the existing SQLite format.
Persistence policy sees the complete proposed write set.

Accepted metadata commits before inference. A failed turn or acknowledgement
cannot undo that version floor or counter reset. The turn commit compares the
metadata revision and atomically writes the session, answer receipt and one
counter increment. `recover` retains the durable loop's current authorization
checks and never increments counters or invokes refresh/inference. Legacy session
updates and checkpoint transitions do not migrate prompt metadata; subsequent
refresh-loop calls reject the session-version mismatch.

Audit signals are `prompt_initialized`, `prompt_bound`, `prompt_refreshed`,
`prompt_refresh_failed`, and `prompt_refresh_rollback`. Failed audit acceptance
withholds execution. An already committed metadata update remains durable; a
retry must accept a fresh binding audit before it can use that metadata.

Owner reservations permit only prompt metadata writes inside the loop's current
reservation. They cannot be forged, used for another owner or reused after the
reservation ends. Cross-process compare-and-write protects stored transitions;
it is not a distributed inference lease, and computation may be duplicated.

## Evidence and limits

Both language suites execute 64 [shared scenarios](../conformance/vectors/llm/refresh-0.1.json).
The parity check compares exact provider transcripts, callbacks, audit events,
metadata and commands, plus eight SemVer comparisons. It also runs actual
TypeScript/Python restart chains, expired-prompt retrieval, rollback-journal
recovery and five competing metadata/turn write scenarios. Direct tests cover
SQL rollback, owner isolation, reservations and cancellation during refresh.
Installed tarball/wheel checks exercise two turns and an interval refresh.

Run the normal repository checks, or isolate this slice with:

```sh
npm run build
uv run --locked python scripts/check-refresh-parity.py
uv run --locked python scripts/generate-refresh-vectors.py --check
uv run --locked python scripts/generate-refresh-schema.py --check
```

This embedded profile deliberately narrows PSP Core 3.2.0 §§21.9–21.17. It uses
host callbacks and fails the invocation on refresh failure. Custom refresh URLs,
adaptive/checkpoint triggers, background timers, degraded
continuation, notifications, scoped/redirect completion and streaming remain
unsupported. These checks establish the stated reference behavior, not complete
RFC conformance, attention improvements or measured security effectiveness.

Hosts may opt into [MCP refresh discovery](llm-mcp-refresh.md) to implement the refresh callback with a separately approved peer. The original callback profile and all loop verification gates remain unchanged.
