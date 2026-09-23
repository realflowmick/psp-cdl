# PSP Automatic Prompt Refresh 0.1

Status: experimental opt-in project draft. License: CC0-1.0.
Extends PSP-LLM-DURABLE-0.1; published baselines remain unchanged.
References: PSP Core 3.2.0 §21.7, §21.9–21.17 and PSP-SIGNATURE-2.0.

## Supported triggers and authority

`RefreshingLlmLoop` requires an explicitly enabled prompt-refresh store and a
host-approved signing callback. It supports signed `refresh-policy` values
`expiration`, `interval`, and their pipe-delimited combination. Omitted policy
defaults to expiration; omitted `refresh-grace` defaults to 300 Unix seconds.
Interval requires a canonical positive safe integer `refresh-interval`.
Grace is a canonical nonnegative safe integer. Other policies, `refresh-on`,
and `refresh-endpoint` reject; no arbitrary URL or model-selected tool is invoked.
This embedded profile does not implement the RFC's MCP discovery/endpoint wire
contract, adaptive refresh, checkpoint refresh, notifications or degraded-node
continuation. Any refresh failure denies the current invocation immediately.

The host supplies fresh session-bound system envelopes and approves each
replacement against authoritative policy and state compatibility. A signature
alone does not authorize changed instructions. Only verified text reaches the
provider. Expired content never authorizes execution or supplies new controls.
Previously verified durable metadata can select an expiration re-fetch after
restart without executing an expired envelope.

## Scheduling and versions

Before initial execution and before each inference, refresh when any declared
trigger is due. Expiration is due at `now >= expires - grace`; actual expiration
always requires replacement even for interval-only policy. Interval is due after
N committed user/final-answer exchanges, before the next inference. Tool calls
and intermediate inference steps do not increment it. Successful refresh resets
the counter immediately; a committed turn increments it once. An acknowledgement
lost after commit does not increment it again on recovery.

Compare content versions using SemVer precedence, ignoring build metadata and
the optional `v` prefix. Reject decrements and emit a rollback audit signal.
Equal-precedence versions must preserve normalized system text, trust level,
priority and refresh directives; signatures, key rotation and session binding
may change. All increases need host compatibility approval, including major
changes. Re-fetch must be newly issued (timestamp >= request time), have a later
timestamp than the accepted prompt, and expire strictly beyond the new grace
window. There are no automatic retry loops within a boundary.

Refresh happens only before inference. If a prompt expires during a provider or
tool callback, the pending response is withheld; no stale candidate is replayed
under new instructions. A later authorized invocation may re-fetch. Policy
checks see the complete transcript with the current system text. Origin metadata
for earlier data remains the host's responsibility; refresh cannot erase it.

## Durable state and atomicity

Private `getPromptState` and `putPromptState` commands store only verified
content version/digest, directives, issuance/expiry and counters. They use a
domain-separated receipt record in the existing SQLite format. Raw envelopes,
prompts and keys are not persisted. Accepted refresh metadata is committed before
inference, independently of turn success, so a later failed turn cannot lower
the version floor or undo a counter reset. Persistence policy covers metadata.

`commitRefreshedTurn` compares the prompt-state revision and writes the next
session version, answer receipt and one counter increment in the same transaction.
Prompt metadata remains bound to the session version. Competing commits fail
closed. Legacy transitions do not migrate refresh state; an unmatched session
version rejects until separately authorized migration is specified.

Same-process prompt writes can borrow a live, exact-owner reservation from the
loop. Tokens are host-only, cannot be forged, and expire with the reservation.
Other owners remain independent. Cross-process compare-and-write detects races;
it does not provide a distributed inference lease or exactly-once provider calls.

## Audit and limits

Host audit callbacks must accept success/failure/rollback events before use.
Binding an existing accepted prompt on a new invocation also requires an accepted
`prompt_bound` event, including after a prior audit or acknowledgement failure.
Events include operation binding, old/new versions and stable codes/digests,
without raw system/user text, credentials or private callback exception details.
Audit failure withholds execution. A committed metadata update remains durable
even if the subsequent audit or acknowledgement fails; recovery rechecks it.

The [private command schema](../../schemas/persistence/prompt-refresh-0.1.schema.json)
is shared by both languages. These commands are host APIs, not new MCP tools or
HTTP routes. The [integration guide](../../docs/llm-refresh.md) documents callbacks,
audit signals, executable evidence and unsupported cases.

The original buffered and durable classes still reject refresh attributes.
Full RFC refresh support, background timers, streaming and measured attention or
security improvements are not claimed. This is boundary-triggered automatic
refresh under explicit host authorization.
