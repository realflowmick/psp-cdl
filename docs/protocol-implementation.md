# Protocol implementation first

Implement PSP and CDL before effectiveness studies. PSP execution takes place
inside the LLM context, as specified in PSP Core §§4, 15–16. The external graph
executor direction is withdrawn; see the [architecture correction and component
audit](in-context-execution.md). External deterministic security controls remain
required at operation boundaries.

## Progress and next implementation stages

Planning reconciliation: 2026-09-29. Milestone #7 tracks the next interpreter and
context/service work; #8/#49 retain evaluation after that implementation.
First produce a requirement-to-prompt gap matrix using the published RFCs and
requirement register, then reconcile PSP instructions, CDL semantics and service
integration in the order below. The matrix is a planning deliverable, not evidence
of completed model behavior. Parser/API adoption reviews continue independently;
this queue does not waive their gates.

| Stage | Status | Concrete next work |
| --- | --- | --- |
| Restore execution ownership | Merged in [#70](https://github.com/realflowmick/psp-cdl/pull/70): external expression selector removed; graph-executor proposal withdrawn; natural-language context transport covered in both languages | Keep all workflow conditions available to the model |
| In-context PSP interpreter | [Core 3.2.0 instruction candidate 0.1](psp-interpreter.md) reconciled in #72; model behavior untested and live integration pending | Review the candidate and open interpretation decisions; exercise its 31 review scenarios after context/service integration |
| In-context CDL interpretation | [CDL 1.5 instruction candidate 0.1](cdl-interpreter.md) reconciled in #77; model behavior untested | Review semantic instructions, profile boundaries and 37 not-run scenarios; connect model-visible governance to actual host decisions during priority 4 |
| Context and service integration | Codecs, signed prompt transport, MCP/API services, persistence and boundary gates exist | Deliver complete relevant application/state context; validate and persist model-produced updates; return service denials and checkpoint results to the interpreting model |
| Remaining external controls | Partial | Finish affinity/capability enforcement, required service forms, revocation, coordination and effect recovery without interpreting PSP business logic |
| Coverage, evaluations and release | Pending | Map both in-context behavior and infrastructure obligations to the 460-requirement register; effectiveness studies and publication follow implementation |

The PSP instruction candidate now has a [reconciliation record](psp-interpreter.md),
topic-level mappings for all 364 PSP requirements and 31 unexecuted review scenarios.
The [CDL companion](cdl-interpreter.md) now indexes the other 96 requirements and
adds 37 unexecuted review scenarios. Together the topic indexes account for all 460
register entries without changing their conformance status. Next is context/service
integration (priority 4), with review and behavioral validation of both candidates.
This is not a TypeScript or Python workflow execution engine. Older local system
prompts remain unchanged; neither their labels nor these drafts establish complete
RFC coverage.
The [example execution preamble](../examples/in-context/execution-boundary.txt)
only establishes ownership and supplements approved interpreter instructions.

Use the [requirement register](../conformance/requirements.json) and published
RFCs as the coverage authority. Passing transport tests and finite policy tests
is not evidence that the LLM interprets every PSP/CDL obligation correctly.
Development tests continue; no owner-run effectiveness study is a prerequisite
for implementing missing behavior. Parser/API reviews retain their adoption
requirements. Attention-layer features require inference-engine support, and
package publication remains disabled until the reviewed release milestone.
