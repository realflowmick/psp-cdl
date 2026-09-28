# Scoped application graphs

The paired core APIs compile a parsed PSP document into a validated node graph.
They resolve node IDs within each container, choose explicit entry points and
select qualified outgoing transitions using compiled source-node controls.
The [draft profile](../specs/profiles/PSP-APPLICATION-GRAPH-0.1.md) records the exact
scope rules, bounds and baseline ambiguities. The published RFC is unchanged.

```ts
import {parseMarkup, compileApplication} from '@psp-cdl/core';
const graph = compileApplication({
  profile: 'PSP-APPLICATION-GRAPH-0.1',
  document: parseMarkup(markup),
  entries: {'/': 'start'}
});
const description = graph.describe();
const selected = graph.select('/start', true, hostQualifiedFacts);
// selected.targetPath identifies a sibling of /start.
```

```python
from psp_cdl_core import parse_markup, compile_application

graph = compile_application({
    'profile': 'PSP-APPLICATION-GRAPH-0.1',
    'document': parse_markup(markup),
    'entries': {'/': 'start'},
})
description = graph.describe()
selected = graph.select('/start', True, host_qualified_facts)
```

`markup` must contain one application with its required metadata and materialized
children. Every node and SYSTEM block needs a valid version; every non-root node
needs a local ID. Use [transition facts](transitions.md) constructed from host
provenance, never caller-asserted or model-generated authority. The completion
argument is also host-owned. Verify document signatures against trusted keys and
current host scope before using the compiled contents in an execution path.

The root is `/`. A child `review` inside composite `branch` is `/branch/review`.
Another container can have its own `review`; sibling duplicates fail. Default
entry is the first child. The optional host `entries` map selects direct children
by local ID at exact container paths. Descriptions are detached JSON, retain raw
attributes and non-transition sections, and cannot change subsequent selections.
The [shared schema](../schemas/application-graph-0.1.schema.json) describes request,
description and selection shapes; runtime checks enforce scopes and expressions.

A container's explicitly sourced edges connect its children. Its sourceless edges
connect the completed container to its siblings. A leaf's source defaults to itself
and cannot name another node. Parent-declared edges precede node-local edges,
then the selector applies explicit priority and stable order. Compilation rejects
unsupported expressions without evaluating facts. Selection returns scoped paths,
the merged edge index and used fact names; it performs no state write.

56 shared cases compare complete descriptions, selections and error codes in both
languages. Additional tests cover parsed markup, preserved SYSTEM content,
mutation isolation, JSON accessors, node count and nesting bounds. Run:

```powershell
npm run build --workspace @psp-cdl/core
uv run --locked python scripts/check-graph-parity.py
```

Compilation supports structure for all seven registered node types. It does not
execute prompt, connector, checkpoint, loop, reset or container semantics. Retained
configurations are not yet validated as executable configurations. `decision` is
not a registered type; decisions use transitions. Unmaterialized lazy containers,
hidden executable nodes, cross-scope edges and unknown section types fail explicitly.
A node without outgoing edges is a terminal candidate, not automatic application
completion. Graph cycles do not establish termination.

The next implementation stage is a durable executor: source-bound output schema
validation, atomic transition/error persistence, container stack handling and
registered node handlers. Child application policies, affinity, complete CDL
propagation and remaining service/effect behavior stay on the
[implementation queue](protocol-implementation.md). `executionSupported: false`
in the description makes this boundary explicit; this profile does not establish
full protocol conformance or security effectiveness.
