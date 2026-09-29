# PSP execution belongs in context

PSP Core §§4, 15 and 16 put workflow execution in the LLM's context window.
The LLM interprets node instructions, maintains application state, evaluates
natural-language and expression-like conditions, and chooses transitions.
A natural-language condition is executable PSP content, not an unsupported host
expression. CDL semantic interpretation also takes place in context; finite
external policy checks provide additional enforcement at observable boundaries.

## Correction recorded 2026-09-28

The expression-only `selectTransition` / `select_transition` APIs introduced in
PR #68 were the wrong execution model. They and their grammar, schema, fixtures
and claimed feature metadata are removed. The unmerged graph-executor work in
PR #69 is withdrawn. Its compiler rejected natural-language conditions and its
planned durable executor would have moved PSP interpretation outside the LLM.
No external PSP graph executor is planned. Published RFC sources are unchanged.

The existing codec remains available for structural parsing and reversible
transport. It preserves transition text without interpreting it. Removing the
external selector does not remove signature, identity, capability, permission,
CDL operation-gating or persistence checks.

## Responsibility audit

| Layer | Responsibility | Boundary |
| --- | --- | --- |
| LLM and its context | Interpret PSP/CDL, evaluate all condition forms, choose nodes, maintain workflow state and outputs, request tools and persistence | Workflow decisions do not grant credentials or permission for effects |
| Codec | Preserve full document structure and text across markup/object/JSON | No condition grammar or business-logic evaluation |
| LLMProxy/provider adapter | Deliver approved interpreter instructions, application and appropriate context; convey model output/tool requests; enforce inference and release policy | A provider/tool I/O loop is not a PSP node executor |
| MCPProxy/security services | Verify signatures and provenance, authenticate callers, enforce tool and data boundaries | Do not determine the truth of a transition condition |
| Persistence/checkpoints | Validate and atomically store authorized model-produced workflow updates; return actual receipts/errors | Database identity/version checks do not replace the in-context workflow state |
| Completion/refresh/redirect adapters | Enforce lifecycle effects at the boundary and deliver refreshed or target context | Host callbacks must not become a second workflow interpreter |

`LoopHost.prompt` supplies the signed text delivered to the model. For PSP, that
text must contain the approved interpreter instructions and the complete relevant
PSP application/context, including transitions and nested nodes. Do not select one
node externally and discard the graph or reduce conditions to Boolean host facts.
Signature verification still runs before inference. Transporting a signed outer
prompt does not by itself verify every nested signature.

`planTurn` / `plan_turn` receives the model's final candidate and transcript.
Its purpose is validating/projecting the model-produced state for persistence and
retaining provenance. `authorizeTransition` / `authorize_transition` authorizes a
requested store operation; its name does not mean that it should choose a PSP
branch. Reject unauthorized effects and report failure back to the application.
Never silently select a different business branch to work around a denial.

The durable loop's `complete` field is a host-validated application completion
report. A provider's `type: final` means only that the provider turn ended; it is
not proof that a node or application completed. Infrastructure lockdown and
revocation remain external controls. Model-visible workflow/session metadata is
allowed; private credentials and host authentication/policy authority remain
outside model input.

## Executable regression evidence

The [in-context example](../examples/in-context/README.md) and shared transport
cases exercise the signed prompt path in both languages. The provider receives
nested nodes, an output schema with CDL metadata, natural-language conditions and
expression-like conditions intact. Two scripted providers return different next
nodes for the same input; the proxy preserves their outputs without evaluating
conditions or deciding which branch is true. Signature, inference-policy and
release-policy failures still deny at their respective boundaries.

These tests establish transport and boundary behavior. Scripted responses do not
establish model interpretation, complete PSP/CDL execution, or security efficacy.
The [implementation queue](protocol-implementation.md) tracks that remaining work.
