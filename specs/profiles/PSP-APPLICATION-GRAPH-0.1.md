# PSP application graph 0.1

Status: draft implementation profile, explicitly selected by callers. CC0-1.0;
see [license](../../LICENSES/CC0-1.0.txt). Published RFCs remain unchanged.

This additive profile implements structural compilation for PSP Core 3.2.0
§§8.1–8.2, 9.2–9.3, 10, 13.1, 15, 16.1 and 30.1, using
[Codec 1.0](PSP-CODEC-1.0.md) and
[Transitions 0.1](PSP-TRANSITIONS-0.1.md). It does not authenticate a document,
execute nodes, authorize persistence, or enforce application/child policies.

## Admission and identity

`compileApplication` / `compile_application` accepts a JSON request with exactly
`profile: "PSP-APPLICATION-GRAPH-0.1"`, `document`, and optional `entries`.
`document` is a codec document object. Parse markup with the existing codec first.
Its optional source hint is never used as authority or substituted for its tree.
Admission is bounded to 4 MiB canonical request and existing codec limits, with
at most 1,024 executable nodes including the root, 32 node levels, 256 combined
outgoing transitions per node, 256 transitions per source block and 1,024 children
per scope. The canonical description is bounded to 8 MiB.

There must be exactly one top-level `type=node node-type=application` section;
only ASCII whitespace may surround it. Every node has a valid SemVer `version`.
Every non-root node also requires an `id` under the transition profile's ID syntax.
Sibling IDs are unique; IDs in different containers may repeat. The root's ID is
optional, resolving the tension between §9.2 and the ID-less root example in §8.1
only for this draft profile. Applications require nonempty `name` and `session-id`
strings (at most 256 UTF-8 bytes). These attributes are document metadata, not
authenticated session identity. The original attributes remain unchanged.

Only §30.1's seven types are admitted: application, prompt, composite, connector,
checkpoint, loop and reset. `decision` is not a registered node type; branching
uses transitions, usually on a prompt node. Applications, composites and loops
must have children. Other types cannot contain executable child nodes. Lazy
references without materialized children are unsupported; compilation performs
no fetching. `load="lazy"` is preserved for the executor but does not exempt a
materialized node from validation. Unknown node types fail explicitly.

Root path is `/`; child paths append their local ID with `/`. IDs exclude `/`,
so paths are unambiguous. Node records are in pre-order and include parent path,
local ID (null for an ID-less root), canonical version, original attributes,
ordered child paths, entry path, retained non-node sections and outgoing edges.
Text directly inside a node, including whitespace, is retained in `text`, never treated
as executable instructions or discarded. SYSTEM/CONTEXT remain separate sections.

## Sections and entry points

At most one direct SYSTEM, transitions, output-schema, workflow-state, output,
input, settings, threat-policy, post-completion or each node-config block is
allowed per node. Multiple CONTEXT/user/custom/link/machine blocks are retained.
SYSTEM blocks require valid versions, including SYSTEM inside post-completion.
Post-completion blocks belong only to applications and contain one SYSTEM plus
optional threat-policy and whitespace. No node may be hidden inside a data block.
Unknown section types fail with `UNSUPPORTED_GRAPH_SECTION`; they are not silently
interpreted or discarded. Non-transition sections remain exact codec trees;
compilation does not strip signatures, flatten nested content or normalize text.

Transitions must have a text-only strict JSON array body. A non-JSON
`content-type` on transitions is unsupported. Duplicate JSON keys fail through
the codec. Other data/config bodies are retained without claiming schema or
execution validation. In particular, configuration preservation is not support
for executing a connector, loop or reset.

The default entry of every container is its first child, per §16.1's typical
entry rule. Host-owned `entries` may map a container's exact path to a direct
child ID. Unknown paths, non-containers and non-child selections fail. There is
no traversal, URL resolution, arbitrary entry expression or model-selected entry.

## Transition scopes

For a leaf's transitions, an absent source means that leaf; an explicit source
must name that same leaf. Targets must be its siblings. In a container's block,
an explicit source identifies a direct child, and its target must also be a direct
child. An absent source on a non-root container means an outgoing edge from the
container to one of its siblings, taken only after container completion. An absent
source on the root is ambiguous and fails. This pins the distinction between
composite internal routing and completed-composite routing illustrated by the RFC.

Parent-declared edges precede node-local edges for a source; within each block,
appearance order is retained. The transition profile's descending priority and
stable ties then apply. Missing targets, cross-scope paths and undeclared magic
`complete` targets fail. A node with no outgoing edges is only a terminal candidate;
the executor/host must decide completion. Cycles are admitted structurally; this
profile does not promise termination or infer a runtime iteration budget.

Expressions and each node's transition controls are checked at compile time using
the same parser as the selector, without invented facts or condition evaluation.
Natural-language conditions remain `UNSUPPORTED_CONDITION` for this profile.

## Public compiled object

`describe()` returns a detached JSON description with profile, root/entry paths,
nodes and `executionSupported: false`. It is not a signed artifact or authority
receipt. `select(path, completed, facts)` uses that compiled source node's
transitions and controls with fresh host-owned facts through the existing
qualified selector. It returns the graph profile, source/target paths, original
merged-edge index and used fact names. Root selection, unknown paths, incomplete
nodes, missing qualified data and no-match cases fail explicitly.

Mutating the input or a returned description must not change later selections.
Descriptions are not accepted as compiler input; recompile the original verified
document rather than trusting a deserialized node table. The host remains
responsible for signature/key/time verification, authenticated scope, restrictive
child-application policy, CDL handling, output-schema validation and atomic state
updates. A compiled graph is not permission to execute its contents.
