# Protocol implementation first

Implement PSP and CDL before effectiveness studies. PSP execution takes place
inside the LLM context, as specified in PSP Core §§4, 15–16. The external graph
executor direction is withdrawn; see the [architecture correction and component
audit](in-context-execution.md). External deterministic security controls remain
required at operation boundaries.

## Progress and next implementation stages

Planning reconciliation: 2026-10-03, through merged #82. Milestone #7 tracks joint
model-behavior validation and remaining context/service work; #8/#49 retain
evaluation after that implementation. Requirement-to-prompt topic indexes, both
instruction candidates, initial service integration and the joint development
harness are delivered. The indexes are planning deliverables, not evidence of
completed model behavior. Parser/API adoption reviews continue independently;
this queue does not waive their gates.

| Stage | Status | Concrete next work |
| --- | --- | --- |
| Restore execution ownership | Merged in [#70](https://github.com/realflowmick/psp-cdl/pull/70): external expression selector removed; graph-executor proposal withdrawn; natural-language context transport covered in both languages | Keep all workflow conditions available to the model |
| In-context PSP interpreter | [Core 3.2.0 instruction candidate 0.1](psp-interpreter.md) delivered in merged #73; #72 closed; model behavior untested | Review the candidate and open interpretation decisions; exercise its 31 original review scenarios |
| In-context CDL interpretation | [CDL 1.5 instruction candidate 0.1](cdl-interpreter.md) delivered in merged #78; #77 closed; model behavior untested | Review semantic instructions, profile boundaries and 37 original review scenarios |
| Context and service integration | [ContextLlmLoop](context-service.md) merged in #80; #79 closed; candidate/application text, authorized state, writes, receipts/denials and checkpoint/resume supported | Review host completeness and failure recovery; integrate remaining service forms and completion modes |
| Joint development validation | [Harness and context provider transcripts](joint-interpreter-validation.md) merged in #82; #81 closed; six paired rehearsals, source-pinned bundles, observations and semantic-review recording | Under #7, complete provider prerequisites for the first bounded Python observation, review its actual model/service evidence, then extend exact fixtures across all 68 original scenarios |
| Remaining external controls | Partial | Finish affinity/capability enforcement, required service forms, revocation, coordination and effect recovery without interpreting PSP business logic |
| Coverage, evaluations and release | Pending | Map both in-context behavior and infrastructure obligations to the 460-requirement register; effectiveness studies and publication follow implementation |

The PSP instruction candidate now has a [reconciliation record](psp-interpreter.md),
topic-level mappings for all 364 PSP requirements and 31 unexecuted review scenarios.
The [CDL companion](cdl-interpreter.md) now indexes the other 96 requirements and
adds 37 unexecuted review scenarios. Together the topic indexes account for all 460
register entries without changing their conformance status. Priority 4 now has a [context/service implementation](context-service.md) and
scripted runtime evidence. Joint model-behavior validation and the documented
unsupported integrations remain pending.
This is not a TypeScript or Python workflow execution engine. Older local system
prompts remain unchanged; neither their labels nor these drafts establish complete
RFC coverage.
The [example execution preamble](../examples/in-context/execution-boundary.txt)
only establishes ownership and supplements approved interpreter instructions.

The [first bounded observation](joint-interpreter-validation.md#first-bounded-observation)
uses Python `natural-language` with at most two provider calls and 1,024 output
tokens per call. Its offline rehearsal does not satisfy semantic validation.
Actual project/capability inventory and a host credential remain pending; review
the applicable interpretation/profile choices and the completed pinned bundle
before live execution. Correct observed defects before expanding to further cases
and paired model observations. Remaining context/service implementation and
parser/API reviews can progress independently of this provider dependency.

Use the [requirement register](../conformance/requirements.json) and published
RFCs as the coverage authority. Passing transport tests and finite policy tests
is not evidence that the LLM interprets every PSP/CDL obligation correctly.
Development tests continue; no owner-run effectiveness study is a prerequisite
for implementing missing behavior. Parser/API reviews retain their adoption
requirements. Attention-layer features require inference-engine support, and
package publication remains disabled until the reviewed release milestone.
