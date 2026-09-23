# Scoped post-completion conversation

`ScopedLlmLoop` implements the opt-in draft
[PSP LLM Scoped Continuation 0.1](../specs/profiles/PSP-LLM-SCOPED-0.1.md).
It replaces workflow instructions after completion and keeps follow-up decisions,
threat state and receipts durable without reopening the workflow.

Use the same [durable host](llm-durable.md), provider and coordinated store/gate,
with store options `durableTurns: true, scopedTurns: true` in TypeScript or
`durable_turns=True, scoped_turns=True` in Python. The configuration is:

```typescript
const configuration = {
  postCompletion: "scoped" as const,
  scope: {
    id: "results", version: "1",
    system: "Discuss only this workflow's completed results.",
    threatPolicy: null
  }
};
const loop = new ScopedLlmLoop(store, gate, host, provider, configuration);
const result = await loop.run(token, sessionId, {message}, {
  requestId, expectedVersion, deadline, cancelled, maxSteps: 4
});
```

```python
configuration = {
    "postCompletion": "scoped",
    "scope": {
        "id": "results", "version": "1",
        "system": "Discuss only this workflow's completed results.",
        "threatPolicy": None,
    },
}
loop = ScopedLlmLoop(store, gate, host, provider, configuration)
result = loop.run(token, session_id, {"message": message}, {
    "requestId": request_id, "expectedVersion": expected_version,
    "deadline": deadline, "cancelled": cancelled, "maxSteps": 4,
})
```

Extract the SYSTEM text and optional threat-policy selector from the trusted
application's post-completion section. A configured policy is exactly
`{id,version}`. Null continues the application's policy. Configuration is copied
and its descriptor is pinned at completion; changing it requires a new session.
The SYSTEM digest is SHA-256 over JCS `{system: text}`.

In addition to the durable callbacks, implement these host-only callbacks:

| TypeScript / Python | Contract |
| --- | --- |
| `applicationThreat` / `application_threat` | `(principal,binding,session)` returns `{policy:{id,version},state}` from current authoritative application threat state. Called only when the workflow completes. |
| `scopedPrompt` / `scoped_prompt` | `(principal,binding)` returns a signed SYSTEM envelope containing exactly the configured text. Sign attributes from exported `scopedPromptContext(binding)` / `scoped_prompt_context(binding)` with host-owned credentials. |
| `scopeBoundary` / `scope_boundary` | `(principal,binding,data)` returns exactly `{bindingDigest,decision,threatState}`. Decisions are `allow`, `deny`, `unsupported`. Resolve and execute the selected threat policy deterministically outside model text. |
| `planScopedTurn` / `plan_scoped_turn` | `(principal,binding,data)` returns exactly `{retained}` after an allowed answer. Preserve existing restrictions and all new data origins. |

`applicationThreat` must return the real accumulated state, not a fresh default.
This profile always carries that state. An explicit scoped threat policy replaces
only the policy selector. The existing transition authorizer verifies the initial
snapshot against current authority at commit and approves every later exact state
change. The persistence authorizer independently approves the complete write set.

Boundary bindings contain owner/session/version, current loop authority, scope,
request/input digests, phase, data digest and current threat-state digest. Data
contains the new request, original completed output and retained evidence, current
retained evidence, current threat state, and an optional candidate. Return the
digest of the supplied binding; copying a prior decision fails validation.

For a synthetic integration, an ingress rule can allow only an exact question such
as `Explain the completed result.` and deny every other input, while an egress
rule allows only an approved answer. Real hosts must define their own deterministic
policy. The library does not classify arbitrary topics or turn prose instructions
into enforceable rules. Unknown rules must return `unsupported` and stop the call.

Ingress denial occurs before scoped prompt loading and inference. After approval,
the provider receives exactly one replacement SYSTEM message, the original
completed answer as an assistant message, and the current user message. Previous
workflow instructions and follow-up transcripts are not replayed. The completed
answer remains untrusted data. Authoritative threat state, policy metadata,
credentials and bindings never become provider messages. The CDL callback sees
the complete proposed provider request and both original/current retained evidence.

The scoped phase performs one buffered inference with an empty tool list. Tool
responses and streams are rejected. `maxSteps` keeps the ordinary 1–32 input
contract, but no additional scoped inference steps are performed. Owner exclusion
holds during boundary checks and inference; checks repeat before commit and release.
All local host policy/registry writers must use that same coordination.

Successful completion and follow-ups retain `receipt.status: "completed"` and add
`scoped` metadata: profile, scope digest, turn/violation counters, outcome and a
nullable signal. The application's state, node and policy bindings stay frozen.
Session versions advance for each committed answer or violation, so callers must
read the current authorized session version after a denied exchange as well.

A boundary violation commits updated threat state and an immutable
`post_completion_violation` **hard** signal, then throws
`PSP_POST_COMPLETION_VIOLATION`. The signal stores time, phase and input digest;
the receipt stores neither raw rejected input nor rejected model output. Scoped
signals live in the authorized store; forwarding them to an audit service is a
host integration. Failed storage or transition approval denies the exchange and
leaves the prior revision intact. Allowed threat-state changes commit only with
an approved answer.

`recover` uses current identity, host approval and CDL release checks. It never
invokes inference or repeats boundary/threat updates. Recovering a violation
receipt raises its violation code. A failure after commit can withhold an answer;
explicit recovery retrieves it only if currently authorized. Generic workflow
updates, checkpoints, old loops and MCP dispatch cannot resume completed sessions.

The shared private schema is
[`scoped-0.1.schema.json`](../schemas/persistence/scoped-0.1.schema.json).
Run `python scripts/check-scoped-parity.py` for shared scenarios, actual
mixed-language continuation/recovery after restart, hot-journal recovery, and
answer/violation commit races. The APIs remain experimental. Scoped tool use,
streaming, refresh/redirect composition, scope migration and distributed authority
revocation are unsupported; host policy integration and independent review remain
necessary before broader claims.
