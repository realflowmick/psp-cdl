# In-context service integration

`ContextLlmLoop` connects approved PSP/CDL instructions and complete application
context to the existing buffered model loop and authenticated workflow service
in both languages. The model chooses state and node updates. Services validate
and persist permitted proposals, then return real receipts or sanitized denials
to the next model inference. See the [opt-in draft](../specs/profiles/PSP-CONTEXT-SERVICE-0.1.md)
and [proposal schema](../schemas/context-service.schema.json).

The host explicitly supplies the [PSP](psp-interpreter.md) and
[CDL](cdl-interpreter.md) candidate text, the application and signing callback.
The exact assembled text must survive signature verification. Fresh authorized
session views and prior service/tool events are separate data messages, not
host authority or SYSTEM instructions. Full relevant application state belongs
in those views; credentials, signing keys, private resume tokens and authoritative
policy records stay in host callbacks.

```ts
import {ContextLlmLoop, CONTEXT_SERVICE_PROFILE} from "@psp-cdl/llmproxy";
const loop = new ContextLlmLoop(store, gate, host, provider, workflowService, {
  profile: CONTEXT_SERVICE_PROFILE,
  pspInstructions: approvedPspInstructions,
  cdlInstructions: approvedCdlInstructions,
  application: completeApplication,
  serviceSources: authenticatedServiceCapabilities,
  serviceComplete: true
});
const result = await loop.run(credential, trustedSessionId, {message: userText}, {
  requestId: hostRequestId, maxRounds: 4, maxSteps: 8,
  deadline: host.now() + 30, cancelled: () => signal.aborted
});
```

```python
from psp_cdl_llmproxy import ContextLlmLoop, CONTEXT_SERVICE_PROFILE
loop = ContextLlmLoop(store, gate, host, provider, workflow_service, {
    "profile": CONTEXT_SERVICE_PROFILE,
    "pspInstructions": approved_psp_instructions,
    "cdlInstructions": approved_cdl_instructions,
    "application": complete_application,
    "serviceSources": authenticated_service_capabilities,
    "serviceComplete": True,
})
result = loop.run(credential, trusted_session_id, {"message": user_text}, {
    "requestId": host_request_id, "maxRounds": 4, "maxSteps": 8,
    "deadline": host.now() + 30, "cancelled": cancelled_event.is_set,
})
```

These variables are supplied by the embedding host. `host` implements the
[buffered loop callbacks](llm-loop.md), replacing `prompt` with
`signContext(principal, binding, text)` / `sign_context(...)`. This callback
signs the supplied text with `promptContext(binding)` / `prompt_context(binding)`
and the same key, trust, scope and expiry rules. It is not permission to accept
unverified nested content. `authorizeFinal` / `authorize_final` approves only
conversational answers. Service requests instead pass transcript policy and
the workflow service's existing state/schema and operation authorization.

The service and gate must share the loop's store and coordinator. The service's
new optional additive invocation guard is host-only and cannot relax existing
authorization. It binds transcript-derived restrictions and fresh prompt,
session, identity and authority checks to the operation before commit.
`can-write-storage` is conservatively included for this whole service path.
Hosts must resolve all contributing CDL restrictions and evidence; a model's
state or summary cannot erase them. Final answer release and checkpoint receipt
release are independently gated.

## Round trip

1. Fetch an authorized durable state view; bind its revision to fresh signed
   interpreter/application context and run the existing inference/tool loop.
2. Parse a strict model proposal to update state, fetch a node, create a
   checkpoint, or return an answer. Preserve the model's node selection.
3. For a service request, pin host session/revision/request identity, evaluate
   transcript policy and invoke the authenticated service. Storage authorization
   and optimistic concurrency remain mandatory.
4. Feed an actual receipt or a known pre-commit denial to the next authorized
   inference, preserving preceding tool messages. Let the model handle a denial.
5. A checkpoint returns a waiting receipt to the host and stops inference.
   An authorized host resumes through the existing private token channel; a new
   loop invocation reconstructs the saved state. The host-only `resumeAndRun` /
   `resume_and_run` helper takes the existing service resume request plus the
   ordinary turn input/options, pins the target session before commit and feeds
   the actual resume acknowledgment into the next context. No resume token reaches
   the model; direct service resume followed by `run` remains supported.

An answer ends this conversational turn, not the application. Complete durable
history is the proposed application state, validated and governed by the host;
the wrapper does not persist raw transcripts. A post-commit delivery, projection,
release or inference failure can leave a durable write without a returned answer.
Read the actual state and reconcile the service receipt before retrying. The
adapter does not retry, roll back remote effects or choose a fallback branch.

## Evidence and remaining work

Run the [paired examples](../examples/in-context/service/README.md) or:

```sh
npm run build
uv run --locked python scripts/check-context-service-parity.py
```

The shared scripted cases exercise actual SQLite writes, both model-selected
branches, host/storage denials, transcript policy at commit, revocation,
cancellation, authority drift, forbidden selector fields, candidate tampering,
tool-history retention, checkpoint failures and authorized resume reconstruction.
The normal TypeScript/Python suites and full parity runner include these checks.
They are runtime integration evidence; all 31 PSP and 37 CDL semantic review
scenarios remain not-run. Requirement-register statuses and published baselines
are unchanged.

| RFC obligation | Scoped evidence | Still unresolved |
| --- | --- | --- |
| PSP §§4, 15–16: model execution ownership | Two scripted providers choose different paths; exact proposals persist without condition evaluation | Actual model interpretation and joint scenario grading |
| PSP §§5.2–5.3, 13, 22.4: complete context and reconstruction | Both candidates, full example application and authorized persisted state reach inference; resumed invocation reloads state | Host completeness review, durable conversation history and all application forms |
| PSP §§5.4, 22.1–22.2: persistence | Real authorized atomic state replacement, optimistic versions, receipts and denial feedback | Atomicity across remote effects, completion profiles and exactly-once execution |
| CDL §§4–7, 10–13: governing data and processing | Transcript restrictions checked for inference, service writes and release; service denials do not become permissions | Broad semantic interpretation, all profile decisions and live provider evidence |

This slice supports running-state updates, node views and checkpoints. Session
creation, model-driven resume, completion policy composition, automatic refresh and remaining
security/lifecycle service forms remain separate integrations. Streaming and
mutating downstream tools remain unsupported. Before live behavioral validation,
the host must select the reviewed instruction/application bundle, real provider,
resource policy and invocation budget. No live model call, effectiveness result,
full conformance or production-readiness claim is made by this implementation.
