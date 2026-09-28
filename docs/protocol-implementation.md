# Protocol implementation first

Direction recorded 2026-09-28: implement all PSP and CDL before asking the project
owner to run effectiveness studies. Development tests, cross-language parity and
deterministic failure tests continue as implementation work. Study collection and
freeze preparation are sequenced after protocol implementation. Published RFCs
and review/adoption requirements remain intact; explicit draft profiles allow
implementation choices to be tested without silently changing those baselines.

The old focused backlog is not a complete list of missing protocol behavior.
Use the [460-requirement register](../conformance/requirements.json) and RFC
sections as the coverage authority, with explicit applicability and evidence.
Neither the number of closed issues nor existing profile checks measures full
protocol completion. Whole-clause dispositions remain pending.

## Required implementation sequence

1. **Deterministic workflow execution.** Start with the now-implemented
   [qualified transition selector](transitions.md): PSP §§9.3–9.4, 12.5–12.7, 15.
   Next compile parsed applications into validated scoped graphs; enforce node
   identity/version, entry points and structural rules; integrate source-bound
   output validation and persisted transition/error handling. Then execute prompt,
   decision, composite, connector, checkpoint, loop, reset and child-application
   semantics with authoritative state, durable restart and accumulated output.
2. **Complete node and session controls.** Implement hierarchical agent affinity,
   wildcard capability matching, model/capability resolution, restrictive child
   application boundaries, and remaining refresh triggers/failure handling.
   Compose completion, refresh, redirect and scoped continuation with explicit
   current-authority checks; complete tool access and revocation after completion.
3. **Complete CDL handling across those paths.** Audit each CDL requirement for
   parsing, nested inheritance/authorized negation, schema/data binding,
   classification vocabulary and policy-table behavior. Implement missing forms
   with retained origin/obligation evidence at input, connector, computation,
   storage, handoff and release boundaries. Keep unsupported policy forms explicit
   until implemented; a flattened label union is not sufficient evidence.
4. **Complete service and effect execution.** Finish API/security-tool forms and
   their normative dispositions, distributed coordination and mutating dispatch
   with recipient idempotency/recovery. PostgreSQL and OAuth are integration
   tracks, not substitutes for node execution. Track optional host products
   separately from required protocol behavior.
5. **Reconcile executable coverage.** Map actual behavior and negative cases to
   every applicable RFC obligation in both languages. Resolve blocked semantics
   through the existing parser/API review process. Explicitly identify requirements
   needing inference-engine support; host libraries cannot implement attention
   masking by asserting it in a prompt. Resolve all remaining unsupported behavior
   before claiming complete protocol coverage.
6. **Evaluate and release.** Only after implementation coverage is reconciled,
   return to #49 studies and #50–51 reviewed release work. Existing study tooling
   is retained. Package publication remains disabled until its reviewed gate.

PSP's real-time-streaming exclusion means #44 is a separate gateway feature,
not the first missing PSP requirement. It remains on the roadmap with its own
release-boundary contract. No requirement is marked implemented merely by this
queue, a helper API, a schema, or a successful build.
