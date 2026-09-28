# PSP deterministic transitions 0.1

Status: draft implementation profile; explicit library adoption only. Dedicated
to the public domain under [CC0 1.0](../../LICENSES/CC0-1.0.txt).

## Motivation and scope

PSP Core 3.2.0 §§9.3–9.4, 12.5–12.7 and 15 require scoped, ordered transitions
using qualified source data. This profile supplies a deterministic host-side
selection primitive. It does not replace the RFC's natural-language evaluation
mode, authorize a state change, or modify the published baseline. Callers must
verify the node definition and supply completed-node status, sibling IDs and
fresh provenance from authenticated host state, never from model assertions.

## Contract

`selectTransition` / `select_transition` takes one JSON object: `profile` (this
profile's `PSP-TRANSITIONS-0.1` identifier), `nodeId`, `completed`, `siblings`,
`attributes`, `transitions`, and `facts`. Unknown fields fail. `attributes` is
the node's complete string-valued attribute map; unknown `transition-*` controls
fail rather than being ignored. A false `completed` returns `NODE_INCOMPLETE`.
This primitive performs no transition evaluation for unfinished multi-turn nodes.

Each transition has `target_node`, optional `source_node`, optional `condition`
(default `true`), and optional safe-integer `priority` (default zero). The profile
resolves the RFC's unspecified priority direction as descending numeric priority,
then appearance order. All source/target IDs must name members of the supplied
same-parent `siblings`; `nodeId` must also belong to that list. No magic terminal
ID, cross-scope lookup or missing-target fallback exists. Hosts handle application
completion separately. All definitions, including inactive-source definitions,
are checked before selection. No matching condition returns `NO_TRANSITION`.

Expressions support JSON scalar literals (plus single-quoted strings with only
`\\` and `\'` escapes), dotted ASCII identifier paths, parentheses, `NOT`, `AND`,
`OR`, and `== != < <= > >=`. Precedence is parentheses, NOT, comparison, AND, OR.
Use parentheses around a comparison under NOT: `NOT (approved == true)`.
Only Boolean logical operands and final conditions are accepted; no truthiness,
numeric/string coercion, arithmetic, method calls, indexing or host-language eval.
Equality requires identical scalar types (integer/float are the same number type).
Ordering requires numbers. Non-scalar facts return `INVALID_CONDITION_TYPE`.
Natural-language/other expressions return `UNSUPPORTED_CONDITION`.

Facts are a map keyed by exact dotted paths. Every fact contains `value` and a
nonempty `origins` list. Each origin has `endpoint`, `trustLevel`, `priority`,
and `signatureVerified`. The last is a host attestation of a successful scoped,
current signature verification, not a document's `signed` label. Derived facts
must retain **all** contributing origins; every origin must qualify. Hosts must
not replace a mixed-origin computation with a more-trusted label. The library
cannot prove provenance truth or completeness and does not verify signatures.

Default maximum trust is 3, minimum priority 50, signature not required.
`transition-trust` presets and explicit overrides follow §12.6. An absent endpoint
constraint allows any otherwise-qualified endpoint; an explicitly empty constraint
allows none. URI schemes compare case-insensitively; authority and capability
compare case-sensitively. Only a whole capability `*` wildcard is supported;
authority wildcards, queries, fragments, whitespace and partial globs fail.
This profile admits visible ASCII URIs of at most 2,048 characters; Unicode,
control characters and IRI normalization are unsupported. Unknown URI schemes
remain opaque names; they trigger no I/O.

Every referenced fact in each evaluated expression is qualified **before** its
Boolean result is computed, including both sides of AND/OR. Missing or excluded
facts return `INSUFFICIENT_QUALIFIED_DATA`; they cannot select a default edge by
being treated as false. Later conditions after a successful first match are not
evaluated. Malformed facts anywhere fail admission. The result contains only
`profile`, the original `transitionIndex`, `sourceNode`, `targetNode`, and sorted
`usedFacts` names, never raw values. Errors contain codes only; the host records
constraint errors in its policy-governed audit and applies its error-state policy.

Limits: 1 MiB canonical request, 256 transitions, 1,024 siblings/facts, 32 origins
per fact, 4,096 UTF-8 bytes per expression, 512 tokens and 32 syntax nesting levels.
IDs use `[A-Za-z_][A-Za-z0-9_-]{0,127}`; path segments use
`[A-Za-z_][A-Za-z0-9_]*`, at most 16 segments and 256 characters total.
`__proto__`, `prototype`, and `constructor` segments are rejected. JSON admission
uses the existing strict codec. No values, definition objects or input callbacks
are evaluated as executable code.

## Compatibility and remaining work

This is an additive opt-in API with shared TypeScript/Python vectors. Existing
workflow services and persisted wire formats do not change. A host can use this
selector inside transition authorization, rechecking current identity, node,
policy, signatures and state revision before its existing atomic commit. The
selection result is not a capability or reusable authorization receipt.

Document-to-graph compilation, orchestration of all node types, output-schema
source bindings, persisted error transitions and natural-language condition
admission remain separate required execution work. This slice does not claim a
complete PSP runtime, attention isolation or full conformance.
