# PSP Durable LLM Turns 0.1

Status: experimental, opt-in project draft. License: CC0-1.0.
This extends PSP-LLM-LOOP-0.1 and PSP-PERSISTENCE-0.1 without changing either
baseline. References: PSP Core 3.2.0 §8.5.6 (infrastructure lockdown), §22.1–22.2
(state and atomic completion), and CDL-DETERMINISTIC-1.0 / PSP-TRUST-1.0.

## Explicit adoption and authority

The workflow store requires `durableTurns: true` (`durable_turns=True`).
`DurableLlmLoop` additionally requires explicit `{postCompletion: "lockdown"}`
host configuration. The host resolves that effective policy from its authorized
application definition. Missing, unmanaged, scoped and redirect configuration is
unsupported; this draft does not change the RFC's default of unmanaged.

Only the host selects request ID, expected session version, deadline and step
budget. User input remains exactly `{message}`. Models cannot complete a session
or select a policy. The host's `planTurn` chooses `{state, retained, complete}`;
`authorizeTransition` approves the exact proposed write. `retained` must preserve
all originating data restrictions and references needed for later disclosure
decisions. It is not authority supplied by the model. The existing persistence
callback separately authorizes the entire write set, including metadata/receipts.
Do not put credentials, private keys or raw signed prompts in application state.

## Commit and acknowledgement

The host-only `commitTurn` command atomically writes the next session revision
and an immutable turn receipt. It binds request ID, session/expected version,
node, policy, input digest, approved application state, final output, retained
policy metadata, completion choice and explicit post-completion policy.
Node and policy must equal the checked session; graph transitions remain a
separate workflow operation. Request IDs share the existing owner-wide receipt
namespace. An exact low-level retry acknowledges the original commit; differing
commands conflict. `getTurn` reads only durable-turn receipts for the exact owner
and session. Both commands are private store APIs, not HTTP/MCP tools.

Completion sets durable `status: completed` and a top-level `llmCompletion`
record, outside application state. It cannot be reopened by update or checkpoint.
The receipt and session use the same existing SQLite transaction and format;
there is no second database or file. Old libraries still reject execution of a
completed session. ISO lockdown responses restrict completion times to years
1970–9999. Other persistence-profile time behavior is unchanged.

The buffered loop's answer remains inside the durable wrapper until commit.
Before writing, the wrapper rechecks identity/scopes, the exact original session,
authority, deadline, cancellation and signed prompt. The store holds its normal
owner reservation during storage-policy and transition authorization. Conflicts
or denials release no answer. After commit the wrapper rechecks current authority
and the committed session version before release. Failure after commit does not
roll back durable completion; the caller must reconcile via recovery.

Repeated `run` calls never replay a saved answer implicitly. A running session
with the same committed request ID returns `TURN_ALREADY_COMMITTED` (a changed
input conflicts). A completed lockdown session rejects input and emits an audit
signal, including retries submitted as new conversational input. Inference and
read-only tool effects before commit cannot be undone; no exactly-once provider
execution is claimed. Interrupted work without a receipt requires fresh host
authorization. Cross-process workers can duplicate computation; atomic compare
and write admits only one transition for an expected version.

## Lockdown and explicit recovery

Completed lockdown sessions reject before prompt construction, inference or tool
discovery, regardless of user text. The required host audit callback receives
`post_completion_override_attempt`, session identity, time and input digest,
never the raw attempted message. It must enforce its own audit-data policy and
return literal true on accepted logging. Audit failure still rejects input.
The error carries the §8.5.6 lockdown response, with a fixed message, session ID,
ISO `locked_at`, and `policy: lockdown`; transport projection belongs to the host.

`recover` is a separate authenticated historical-receipt read, not a conversation
turn. It never invokes inference/tools or reopens the session. Require current
`sessions:read` scope, exact owner/session/request match, fresh host recovery
authorization and nonempty CDL policy resources bound to the actual receipt and
current recipient capabilities. Old approvals/evidence are not replay permits.
The host resolves current obligations from retained origins and authoritative
records; missing evidence must fail closed. Checks repeat after callbacks before
release. Expired receipts/sessions are unavailable. Recovery may return an older
turn after later state updates only with explicit current host authorization.

## Limits and remaining work

Store commands and complete write sets remain bounded to 1 MiB, so retained state
and duplicate receipt data reduce the maximum answer size. The wrapper does not
persist raw conversation history or automatically feed old turns back to a model;
hosts construct permitted views in freshly signed prompts. Streaming, automatic
refresh, scoped/redirect/unmanaged post-completion execution, graph transitions,
distributed reservations, retention/deletion and provider integrations remain
unsupported. There is no production-readiness, full RFC conformance, attention
isolation or measured security-effectiveness claim.
