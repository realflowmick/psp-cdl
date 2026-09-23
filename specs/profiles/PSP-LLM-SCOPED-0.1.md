# PSP LLM Scoped Continuation Profile 0.1

Status: **draft, experimental, opt-in**. License: CC0-1.0.

This bounded implementation profile addresses PSP Core 3.2.0 §§8.5.2, 8.5.3
and 8.5.6. It preserves published defaults and existing lockdown/redirect APIs.
It is not normative adoption or a complete workflow/security-effectiveness claim.

## Configuration and scope

`ScopedLlmLoop` requires durable turns plus the separate store opt-in
`scopedTurns` / `scoped_turns`. It cannot be combined with the prompt-refresh or
redirect store extensions. Configure exactly `{postCompletion:"scoped",scope}`,
where scope is `{id,version,system,threatPolicy}`. The nonempty SYSTEM text comes
from the trusted application's post-completion section. `threatPolicy` is null to
continue the application policy, or exactly `{id,version}` for an explicit scoped
policy. Neither a user nor a model chooses this configuration.

Before completion the original durable workflow loop applies. At host-approved
completion, `applicationThreat` supplies the authoritative current application
policy and accumulated state as `{policy:{id,version},state}`. The state is always
carried forward in this profile. A configured scoped policy replaces the policy
identifier; otherwise the application policy continues unchanged. The transition
authorizer must verify this snapshot against current host authority at commit.

The initial private command `commitScopedWorkflowTurn` extends the durable turn
command with policy `scoped`, `scope` and `threatState` (both null on continuing
workflow turns). Completion writes separate `llmCompletion` metadata containing
the scope descriptor `{id,version,systemDigest,threatPolicy}`, accumulated threat
state, retained CDL evidence and zeroed continuation/violation counters. The
original application state and `completed` workflow status remain frozen during
subsequent conversation; session revisions still advance for committed exchanges.

## Continuation boundary

Each follow-up uses the same owner/session, a fresh host request ID and expected
session version. The configured scope must match the durable descriptor. A host
`scopeBoundary` callback evaluates ingress before prompt loading or inference,
then egress before release. It returns exactly
`{bindingDigest,decision,threatState}`, with decision `allow`, `deny` or
`unsupported`. Bindings include owner/session/version/authority, scope, request
and input digests, phase, data digest and current threat-state digest.

The host must implement deterministic rules outside generated text, resolve the
selected threat policy and preserve its authoritative state. Natural-language
scope instructions alone are not an enforcement mechanism. This library checks
the exact decision/binding and gates execution; it does not infer topic semantics
or supply a generic natural-language boundary classifier. Unknown or malformed
decisions fail closed. Every writer of host policy/authority must share owner
coordination; distributed authority revocation is outside this profile.

After ingress approval, `scopedPrompt` supplies a fresh signed SYSTEM envelope.
It must contain exactly the configured replacement text and all ordinary signed
loop bindings plus `post-completion`, `scope-id`, `scope-version`, `scope-digest`,
`threat-policy-id` and `threat-policy-version`. The workflow SYSTEM is neither
appended nor replayed. The provider sees only the replacement SYSTEM, the original
completed answer as an assistant message, and the new user message. It receives
no authoritative threat state, policy record, credentials, or workflow history.
The completed answer remains untrusted data, subject to retained CDL restrictions.

This first profile performs one buffered inference per accepted exchange with
`tools: []`. Tool responses, streaming, automatic refresh and additional model
steps are unsupported. CDL checks cover the entire provider request, retained
evidence, model capabilities and output/display recipients. `planScopedTurn`
returns exactly `{retained}` for an approved answer; the host must preserve all
existing restrictions and add current input/output policy origins.

## Durable decisions and recovery

`commitScopedTurn` atomically advances the session revision and continuation
counter, updates only separate threat/evidence metadata, and writes an immutable
receipt. Its exact fields are specified by the shared private schema. A denied
ingress or egress stores no raw request or rejected output. It commits null output,
the updated threat state, an incremented violation counter, and a hard
`post_completion_violation` event with phase, time and input digest. Successful
storage then raises `PSP_POST_COMPLETION_VIOLATION`. Storage/authorization failure
still denies the request; it never falls back to inference or output release.

Allowed boundary state changes commit only with the approved answer. Failures
before that transaction leave the previous state intact. Same-process owner
reservations span boundary checks and inference; exact-session CAS and fresh
identity, authority, signature and policy checks protect the commit/release gap.
Persistence policy independently approves the full write set. Competing workers
can commit only one exchange, but inference is not exactly once across workers.

The durable receipt gains `scoped` metadata with profile, scope digest, turn and
violation counters, outcome (`completion`, `answer`, `violation`) and a nullable
hard-signal event. Successful answers are never released before commit and fresh
release checks. Recovery uses existing current identity/authorization/CDL checks,
never calls the provider or boundary evaluator and never repeats a threat update.
Recovering an authorized violation receipt raises the same violation code without
replaying content. Historical recovery is not permission to continue a session.

Legacy buffered/durable/refresh/redirect loops and MCP dispatch still reject
completed sessions. Generic updates and checkpoint operations cannot reopen or
mutate the completed workflow. Scoped continuation is available only through this
explicit private profile. Expired sessions remain unusable.
