# Durable turns and completion

`DurableLlmLoop` adds the experimental [PSP-LLM-DURABLE-0.1 profile](../specs/profiles/PSP-LLM-DURABLE-0.1.md)
to the [buffered loop](llm-loop.md). Each authorized turn commits approved state
and its answer receipt together. An explicit host completion decision also sets
terminal session status and infrastructure lockdown. The original buffered loop
and published specifications retain their behavior.

## Adoption

Use the same store, gate and owner coordinator as the buffered loop. Enable the
store's `durableTurns: true` option (`durable_turns=True` in Python). The host must
resolve the authorized application's effective post-completion policy and pass
`lockdown` explicitly; missing configuration and other modes reject. This does
not change the RFC's default `unmanaged` policy.

```ts
import { DurableLlmLoop } from "@psp-cdl/llmproxy";
const loop = new DurableLlmLoop(store, gate, host, provider, {postCompletion: "lockdown"});
const result = await loop.run(credential, sessionId, {message: userText}, {
  requestId: hostRequestId, expectedVersion: currentVersion,
  deadline: host.now() + 30, cancelled: () => signal.aborted, maxSteps: 8
});
```

```python
from psp_cdl_llmproxy import DurableLlmLoop
loop = DurableLlmLoop(store, gate, host, provider, {"postCompletion": "lockdown"})
result = loop.run(credential, session_id, {"message": user_text}, {
    "requestId": host_request_id, "expectedVersion": current_version,
    "deadline": host.now() + 30, "cancelled": cancelled_event.is_set, "maxSteps": 8
})
```

Clocks use Unix seconds. The credential requires `sessions:write` and
`models:invoke`, plus the buffered loop's tool scopes. Request IDs share the
existing owner-wide receipt namespace. Only the host chooses controls/session
identity. Model input accepts exactly `{message}` and cannot select completion.

## Additional host callbacks

All callbacks receive detached copies. Boolean approvals require literal true.

| TypeScript / Python | Contract |
| --- | --- |
| `planTurn` / `plan_turn` | `(principal, binding, data)` returns exactly `{state, retained, complete}`. Binding adds request ID and effective post-completion policy; data contains the checked request/transcript and final candidate. `state` and `retained` are objects; `complete` is boolean. |
| `authorizeTransition` / `authorize_transition` | `(principal, context)` approves the exact store command, current session and proposed receipt. The store's existing persistence callback independently approves the full write set. |
| `audit` | `(principal, event)` accepts `post_completion_override_attempt`, session ID, time and input digest. Enforce audit-data policy; the raw attempted message is absent. Failure still denies input. |
| `authorizeRecovery` / `authorize_recovery` | `(principal, binding, receipt)` grants current access to the historical result. |
| `recoveryPolicy` / `recovery_policy` | Same arguments; returns `{bindingDigest, resources}` with nonempty CDL resources. Resolve current evidence from retained origins and authoritative records. Actual current recipient capabilities are merged by the loop. |

`retained` must carry every originating restriction and reference required to
decide a later disclosure. Model-produced labels are not authoritative policy.
Missing evidence must deny. The complete write set includes the answer, retained
metadata, input digest and application state; storage policy applies to all of it.
The bounded transaction may be smaller than the buffered loop's maximum answer
because state and receipt data count toward the same 1 MiB write-set limit.

## Results, retries and recovery

The result extends `{text, provenance}` with
`receipt: {profile, requestId, sessionVersion, status, recovered}`. Status is
`running` for an intermediate turn or `completed` for a terminal turn.
No answer leaves this wrapper before the atomic commit and fresh release checks.
Policy resolution runs again after commit with `committedVersion` in its binding.

A failed acknowledgement can leave a committed receipt. Reconcile by calling
`recover(credential, sessionId, requestId, {deadline, cancelled})`. Recovery needs
`sessions:read`, current host approval and current CDL release permission. It
does not run inference/tools or reopen the session. It may return an earlier
turn after later updates only when the current host explicitly permits it.
Expired sessions/receipts are unavailable.

Retries submitted as conversational input never replay saved answers. A running
session returns `TURN_ALREADY_COMMITTED` for a matching committed turn, or
`IDEMPOTENCY_CONFLICT` for changed input/version. A completed lockdown session
rejects all new input before prompt construction or tool discovery and invokes
the audit callback. `LockdownError.response` carries the RFC's fixed
`session_locked` / `PSP_POST_COMPLETION_LOCKDOWN` object, ISO `locked_at`, session
ID and policy. The host maps that object to its transport. Legacy completed
sessions without this profile remain `INACTIVE_SESSION`.

Private store commands `commitTurn` and `getTurn` have a [shared schema](../schemas/persistence/turns-0.1.schema.json).
They are not added to HTTP/MCP operations. A low-level exact commit retry can
acknowledge an existing receipt; direct store callers must enforce their own
authentication and authorization boundary, as with all workflow commands.

## Evidence and limits

The 62 [shared cases](../conformance/vectors/llm/durable-0.1.json) compare exact
commands, state, receipts, output suppression and audit events. Additional tests
hold transition callbacks during competing writes/cancellation, inject SQL
receipt failure, reopen files in both languages, recover dirty rollback journals,
and race two language processes at the commit boundary. Run normal repository
checks plus `python scripts/check-durable-parity.py` after building packages.

No raw conversation history is persisted or automatically replayed to models.
The host can construct permitted views in a new signed prompt. Inference and
read-only tool calls before a failed commit cannot be undone; cross-process
workers may duplicate computation. Only the state transition is atomic.
Automatic prompt refresh, streaming, live providers, scoped/redirect execution,
distributed reservations, retention/deletion and mutating tools remain pending.
These checks do not establish full conformance or measured security effectiveness.
