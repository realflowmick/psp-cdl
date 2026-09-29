# PSP Context and Service Integration 0.1

Status: experimental, opt-in project draft. License: CC0-1.0.

References: PSP Core 3.2.0 §§4, 5.2–5.4, 13, 15–16 and 22; CDL 1.5 §§4–7,
10–13; PSP-LLM-LOOP-0.1, PSP-WORKFLOW-SERVICE-0.1, CDL-DETERMINISTIC-1.0
and PSP-TRUST-1.0. This draft changes no published baseline and does not establish
full atomic node execution, model interpretation or conformance.

## Adoption and context

Hosts explicitly select `PSP-CONTEXT-SERVICE-0.1` and supply approved PSP/CDL
instruction text, the complete relevant application, an authenticated signing
callback and complete workflow-service capability sources. The reference
integration installs both instruction candidates when the host supplies them;
it does not load files, discover credentials or approve drafts automatically.
The exact concatenated instruction/application text is verified in a signed
SYSTEM envelope against the current session, provider and authority bindings.
Signing the containing text does not verify nested application signatures.

The loop obtains a fresh authorized `WorkflowService.getSession` projection and
places it in a separate data message. The view's revision must match the session
bound to the signed prompt. Host projection must retain the full relevant graph,
execution position, variables, history, output and governance metadata; omitted
private authentication/policy records are not application state. The model
interprets conditions and proposes updates; this adapter never evaluates a
condition, chooses a node or silently repairs a proposed branch.

Previous inference/tool messages, proposals, receipts and denials stay in context
within the invocation. Every new inference is checked against the entire
transcript. They are data, not new SYSTEM instructions or authority. A later
invocation reconstructs context from the authorized durable state projection;
raw conversation history is not automatically persisted. Hosts must preserve
relevant application history in authorized model-produced state and retain
policy origins externally for all later checks.

## Model proposals and host routing

The existing provider contract is unchanged. Ordinary read tools use the MCP
dispatch gate. A provider final response's text contains one of these strict
JSON objects, described by the shared context/service schema:

- `{"type":"answer","text":"..."}` ends only this conversational turn.
- `{"type":"service","operation":"updateSession","arguments":{"nodeId":"...","nodeVersion":"...","state":{}}}` proposes a full replacement of application state and the next node.
- `{"type":"service","operation":"getNode","arguments":{"nodeId":"...","nodeVersion":"..."}}` requests an authorized node view.
- `{"type":"service","operation":"createCheckpoint","arguments":{"expiresAt":1600}}` requests a checkpoint.

Unknown fields and operations reject. Host routing pins session identity,
optimistic version and per-round request IDs. Model-supplied authentication,
policy authority, session selectors, completion status or resume tokens are
never accepted. Updates retain `running` status. A service proposal is checked
for the workflow-service recipient rather than being displayed as an answer.
Host capabilities describe that actual path; this conservative draft adds
`can-write-storage` to every workflow-service operation, including node reads.

The service and loop must share a store. Service authorization and storage policy
remain mandatory. An additive host-only service guard rechecks identity,
deadline/cancellation, exact session, authority, prompt signature and
transcript-derived CDL restrictions before the operation is committed. This
guard is not accepted over HTTP or MCP and cannot replace service authorization.
Hosts validate the proposed state schema and allowed effects in their existing
service/storage callbacks. They must not use those callbacks to interpret PSP
business conditions or choose alternative nodes.

## Results, errors and pause

Successful service results and a finite set of known pre-commit denials are
returned to the model as data on its next authorized inference. Denial codes are
`AUTHORIZATION_DENIED`, `PERSISTENCE_DENIED`, `INVALID_STATE`,
`INVALID_TRANSITION`, `NOT_FOUND` and `STATE_CONFLICT`. No exception message,
credential or raw host record is forwarded. The model can request an alternative
or report a blocked action. Failed authentication, stale authority, policy
failures, expiry, cancellation and ambiguous service failures stop the loop.
There is no automatic retry or host-selected fallback.

A successful checkpoint returns `{status:"waiting",receipt:...}` to the host
after a fresh release check and stops inference. Resume is a separate
authenticated host action using the existing private token handoff. A later
invocation receives the resumed durable state. A successful checkpoint receipt
is not sent to a model while the session is waiting. Model-driven resume and
completion modes are explicitly unsupported in this draft.

The separate host-only `resumeAndRun` / `resume_and_run` helper invokes the
existing resume service with private token lookup, verifies the checkpoint's
target session before commit, and supplies the actual resume acknowledgment to
the next inference. Invalid turn controls reject before resume. Resume still
requires service authorization and storage policy; failed inference after a
successful resume does not roll it back. The model cannot invoke this helper.

Projection/delivery, release or later inference may fail after a state/checkpoint
commit. That failure does not roll back the write. Hosts reconcile actual state
and service receipts using the existing API; they must not rerun the model or
issue a new mutation merely because no final answer was released. The caller
supplies stable invocation request identity. Reusing it for different proposals
can fail with an idempotency conflict. This is not exactly-once inference or
atomicity across remote effects and storage.

## Bounds and evidence

Host controls allow 1–16 service rounds, each with 1–32 buffered inference steps,
under one deadline/cancellation control. A service request on the final allowed
round is rejected before dispatch. Existing canonical JSON and accumulated
transcript bounds apply; context is not silently truncated. Hosts must also
enforce provider token/cost limits. Streaming, automatic prompt refresh,
distributed reservations, mutating downstream tools, durable conversation
history and automatic completion-policy composition remain unsupported.

Shared scripted vectors exercise actual SQLite writes, candidate delivery,
governed read-tool history, service denials and checkpoint/resume. They do not
grade semantic model reasoning. The 31 PSP and 37 CDL interpreter scenarios
remain not-run until executed with an approved model and reviewed observations.
