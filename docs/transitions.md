# Deterministic PSP transitions

The paired core libraries now execute expression-based PSP branching under the
opt-in [transition profile](../specs/profiles/PSP-TRANSITIONS-0.1.md). They select
the first matching same-scope edge after source, trust, priority and signature
qualification. This is an execution primitive for PSP §§12 and 15, not a model
prompt that asks the model to enforce those constraints.

```ts
import { selectTransition, TRANSITION_PROFILE } from "@psp-cdl/core";

const selected = selectTransition({
  profile: TRANSITION_PROFILE,
  nodeId: "route",
  completed: true,
  siblings: ["route", "approve", "manual"],
  attributes: {"transition-endpoints": "mcp://erp/*"},
  transitions: [
    {condition: "amount < 10000", target_node: "approve"},
    {condition: "true", target_node: "manual"}
  ],
  facts: {
    amount: {value: 500, origins: [{
      endpoint: "mcp://erp/refund", trustLevel: 3,
      priority: 50, signatureVerified: true
    }]}
  }
});
// selected.targetNode === "approve"
```

Python exposes `select_transition(request)` and `TRANSITION_PROFILE` from
`psp_cdl_core`, using the same JSON request and response. The
[shared schema](../schemas/transitions-0.1.schema.json) describes the structural
contract; runtime checks additionally enforce expression syntax, resource bounds,
scope membership and source qualification.

`facts`, `attributes`, `completed` and `siblings` are host-owned inputs. In an
integration, load the authenticated node definition and current completion state,
and derive fact origins from verified data. Never copy a model-provided `signed`,
trust level, completion flag or endpoint claim into this request. A computed fact
retains all its contributing origins. A missing or disallowed origin fails with
`INSUFFICIENT_QUALIFIED_DATA`; it does not silently select the default branch.

Inside a [workflow authorization callback](workflow-api.md), compare the selected
target with the proposed command's node ID and approved version. Retain all other
authorization, CDL persistence, state-shape and completion checks. Reconstruct the
selection from current host state for each attempted transition. Existing service
identity/policy checks and the store's versioned atomic write protect the commit;
the returned selection alone grants no authority. Historical receipt access needs
its own current authorization and must not rerun a completed transition.

The paired service tests exercise actual SQLite commits: model-visible state
claims cannot rescue an unqualified fact, an incorrect proposed target is denied,
a qualified edge advances the stored node, and an old revision cannot advance it
again. The host records selection errors under its audit/retention policy; the
core library performs no logging or state mutation.

Requirement evidence is partial: `PSP-3.2.0-L02178-01` has deterministic
source qualification, and `PSP-3.2.0-L02189-01` / `PSP-3.2.0-L06458-01` have
the missing-data error and denied-commit behavior. A full node error-state/audit
orchestrator and the RFC's model-side behavior are not established by these tests.
The requirement register therefore retains its pending whole-clause dispositions.

Run `uv run --locked python scripts/check-transition-parity.py` after building.
Shared cases compare actual results and error codes from both public APIs.
Natural-language conditions, graph compilation, automatic execution of every
node type and persisted workflow error handling remain unfinished. See the
[implementation-first queue](protocol-implementation.md).
