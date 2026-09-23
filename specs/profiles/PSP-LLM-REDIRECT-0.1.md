# PSP LLM Redirect Profile 0.1

Status: **draft, experimental, opt-in**. License: CC0-1.0.

This implementation profile covers PSP Core 3.2.0 §§8.5.1–8.5.3 redirect
completion. It does not change the published `unmanaged` default, adopt normative
semantics, or claim complete workflow conformance. Public normative review remains
required under `specs/PROCESS.md`.

## Boundary and authority

`RedirectingLlmLoop` requires durable turns, a shared owner coordinator, an explicit
`postCompletion: "redirect"` configuration and a host-selected target. The private
store separately requires `redirectTurns` / `redirect_turns`. The original durable
and refreshing loops continue to require lockdown. Redirect and prompt-refresh
store extensions cannot be combined in this profile.

Targets use the deliberately restricted URI form
`mcp://<lowercase DNS name>/applications/<ASCII identifier>`. No credentials, port,
query, fragment, percent escapes or network resolution is supported. A host callback
resolves the exact configured URI to an immutable, same-tenant application node,
node version, policy version and expiration. Other URI forms are **unsupported**;
this restriction does not redefine the RFC URI grammar. The target node identifier
must differ from the source. Hosts must verify that it is an approved application.
Neither the user message nor model output can select the target or completion mode.

The durable host approves completion and retained policy evidence. The transition
authorizer sees the complete command, source state and proposed receipt including
the fresh target session identifier. A separate, digest-bound `redirectPolicy`
decision evaluates nonempty CDL resources for the exact output, retained evidence
and target recipient. Unknown policy, missing evidence, stale bindings and denial
prevent the entire transaction. Host callbacks supply current target capabilities,
application approval and all data origins; model labels are never authoritative.
Transition approval revalidates the current URI-to-application mapping. Every
same-process policy/registry writer must share owner coordination; distributed
authority revocation is not supplied by this profile.

## Atomic transition

The private `commitRedirectTurn` command extends the durable turn shape with
`postCompletion: "redirect"` and `redirect`, either null for a continuing turn or
exactly `{target,nodeId,nodeVersion,policyVersion,expiresAt}` for completion.
Target expiration must be after the current clock and no later than source expiry.

One compare-and-write transaction commits source application state, terminal
redirect metadata, immutable turn receipt and a fresh running target session at
version 1. The target state is **exactly** `{input: output, retained}`. Source state,
history, SYSTEM instructions, checkpoints, credentials and accumulated threat state
are not copied. The target host initializes its own fresh threat policy/state and
must carry the retained CDL evidence into every subsequent policy decision.

The target's prompt, authority, gate and inference are initialized separately by
the host using the returned routing descriptor. Creating the target session does
not invoke its provider or tools. It is not an HTTP redirect or an arbitrary URI
fetch. Cross-owner/tenant handoff and remote/distributed handoff are unsupported.

The receipt's optional `redirect` is
`{profile,target,sessionId,nodeId,nodeVersion,policyVersion,expiresAt}` with profile
`PSP-LLM-REDIRECT-0.1`. Completed source metadata uses that profile, policy
`redirect`, `requestId`, `completedAt` and the same descriptor. Continuing turns
create no target and no terminal metadata. Old private commands remain unchanged.

## Failure and recovery

No output or routing descriptor is released before the atomic commit and current
source release checks. The transaction still exists if a later release check or
the process fails. Explicit recovery uses current identity, authorization and CDL
release checks and returns the original historical descriptor without creating
another target. It does not assert that the target remains live or authorized;
normal target ingress must check its current state and policy. Repeated input on
a completed source fails `INACTIVE_SESSION` before prompt/provider/tool calls.

Full-write persistence authorization, bounded writes, idempotency, tenant/owner
isolation and immutable completed sources retain the durable profile rules.
CAS races can commit only one target. This does not make inference or tools
exactly once across processes. Recovery never invokes either provider.

Scoped continuation, refresh/redirect composition, unmanaged continuation,
streaming, automatic target inference and policy revocation across distributed
authorities remain outside this profile.
