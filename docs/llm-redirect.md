# Atomic post-completion redirect

`RedirectingLlmLoop` implements the opt-in draft
[PSP LLM Redirect Profile 0.1](../specs/profiles/PSP-LLM-REDIRECT-0.1.md).
It completes a source workflow and creates a fresh target session in one local
transaction. The paired APIs use the existing [durable host](llm-durable.md),
provider, store and MCP gate. Published defaults and lockdown APIs are unchanged.

Enable `durableTurns: true, redirectTurns: true` on the TypeScript store or
`durable_turns=True, redirect_turns=True` in Python. Construct the loop with:

```typescript
const loop = new RedirectingLlmLoop(store, gate, host, provider, {
  postCompletion: "redirect",
  target: "mcp://realflow/applications/support"
});
const result = await loop.run(token, sourceSessionId, {message}, {
  requestId, expectedVersion, deadline, cancelled, maxSteps: 4
});
```

```python
loop = RedirectingLlmLoop(store, gate, host, provider, {
    "postCompletion": "redirect",
    "target": "mcp://realflow/applications/support",
})
result = loop.run(token, source_session_id, {"message": message}, {
    "requestId": request_id, "expectedVersion": expected_version,
    "deadline": deadline, "cancelled": cancelled, "maxSteps": 4,
})
```

The URI is an exact host configuration value with a restricted grammar. It is
never fetched. `resolveRedirect(principal, binding, target)` /
`resolve_redirect(...)` returns exactly
`{nodeId,nodeVersion,policyVersion,expiresAt}`. Use a trusted application registry,
verify same-tenant application access, and choose a target node distinct from the
source. The node must already exist. Expiration cannot exceed source expiry.

`planTurn` / `plan_turn` receives `postCompletion: "redirect"` in its host-only
binding. Continuing turns do not resolve a target. On completion,
`authorizeTransition` / `authorize_transition` approves the full private command
and proposed receipt, including the fresh target ID. The persistence host approves
all source, target and receipt writes together.
Transition approval must revalidate the URI-to-application mapping at commit;
resolution alone is not a lasting permission to transfer.

`redirectPolicy(principal, binding, data)` / `redirect_policy(...)` is a separate
CDL transfer check. Return exactly `{bindingDigest, resources}` with the digest of
the supplied binding and nonempty current policy resources. The binding includes
the original loop authority, request ID, complete command digest and exact target
descriptor. Data is exactly `{output, retained}`. Resolve every retained origin
and current target/path capability; a permissive placeholder is not a policy
integration. Host policy/registry changes must participate in the shared owner
coordination. External authority revocation needs a separate integration contract.

The target begins running at version 1 with state exactly `{input: output,
retained}`. Source application state and accumulated threat state are not copied.
Initialize the target's own fresh threat policy/state, construct its own signed
SYSTEM prompt and gate, and include retained CDL evidence in every target policy
decision. The redirect loop does not invoke the target provider or tools.

The normal durable result gains `redirect` on a completed handoff:

```json
{
  "profile": "PSP-LLM-REDIRECT-0.1",
  "target": "mcp://realflow/applications/support",
  "sessionId": "<fresh target UUID>",
  "nodeId": "support",
  "nodeVersion": "1",
  "policyVersion": "target-policy",
  "expiresAt": 2000
}
```

No answer or descriptor is released before commit and current source release
checks. A failure after commit can leave a completed handoff with no response.
Use explicit `recover` with current authentication, recovery authorization and CDL
checks; it returns the original historical descriptor and creates nothing.
Revalidate the target at its normal ingress before using it. The descriptor is
neither a credential nor evidence of current target liveness. Repeated source
conversation fails `INACTIVE_SESSION` before inference.

The shared vectors and paired tests cover accepted and denied transfers, exact
bindings, owner isolation, source closure, retained evidence, callback mutation,
rollback and withheld-output recovery. The parity harness also checks process
restart, hot-journal recovery and competing/identical mixed-language commits.
This is scoped experimental behavior, not a complete conformance or security
effectiveness claim. Scoped continuation, refresh/redirect composition, remote
handoff, automatic target inference, streaming and live providers remain pending.
