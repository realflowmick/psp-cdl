# Offline workflow matrix

The first [#48](https://github.com/realflowmick/psp-cdl/issues/48) slice connects
the buffered model loop, durable SQLite state and dispatch gate to an actual
isolated MCP child. Independent TypeScript and Python host adapters execute the
same [corpus](../conformance/vectors/topologies/matrix-0.1.json) against both
child implementations. This is scoped draft-profile coverage of Topology B's
deterministic host boundary, using a scripted provider. It is not semantic model
testing, full RFC conformance, a signed effectiveness result or production validation.

## Run

Install the locked workspaces and build TypeScript first, using Node >=22 and
Python >=3.12 as described in the [repository setup](../README.md).

```sh
uv run --locked python scripts/run-topology-matrix.py --output .artifacts/workflow-matrix.json
uv run --locked python scripts/run-topology-matrix.py --check --output .artifacts/workflow-matrix.json
```

The first command exits **2** while any matrix cells are blocked, unsupported or
skipped. `--check` exits **0** only when all 48 expected Topology B fixture runs
pass; it does not change unavailable cells into passes. Both commands exit **1**
on an observed mismatch or adapter error. `--host python` or `--peer typescript`
select a subset; omitted executable combinations become `skipped`, and a subset
cannot satisfy `--check`. Setup/schema failures exit nonzero without claiming a run.

`npm run conformance` and `python -m psp_cdl_test_harness` still report
`not_implemented` and exit 2 for full workflow conformance. The 511 library-profile
checks remain a separate mode. The matrix runs as part of cross-language parity.

## Coverage

| Topology | TS → TS | TS → Python | Python → TS | Python → Python |
| --- | --- | --- | --- | --- |
| A: semantic-only | Unsupported | Unsupported | Unsupported | Unsupported |
| B: host-mediated | 12 executable fixtures | 12 executable fixtures | 12 executable fixtures | 12 executable fixtures |
| C: full proxy chain | Unsupported | Unsupported | Unsupported | Unsupported |

Each B column includes eleven mediated scenarios and one deliberately unmediated
bypass control. The fixture server does not enforce output covenants; the
host-embedded gate and an MCP transport do not constitute Topology C. Topology A
needs a semantic model adapter and a separately authorized study. There is no
network model call, provider credential lookup or external export destination.

| Original seed | Workflow mapping | Scope |
| --- | --- | --- |
| CDL-001 | Conflicting tool capability; denial before a downstream call | Existing finite CDL profile |
| CDL-002 | Blocked in every cell | Mixed class/covenant string has no declaration kind; #34 disposition pending |
| PSP-001 | Exact disallowed agent URI; no downstream call | Host node affinity |
| PSP-002 | Allowed URI, real child read, observed data echoed through the provider and final output | Benign control with other checks enabled |
| PSP-003 | Unknown signing key ID with an empty trusted-key set | Prompt rejected before inference |

The original seed files and requirement inventory retain their draft/pending
status. These mappings add scoped execution evidence without adopting the seed
expectations as whole-RFC conformance. Expanded requirements remain subject to
review and further adapters; the manifest pins the inventory hash.

Additional cases cover tenant substitution, cancellation before dispatch and
after a real read, concurrent state replacement, reuse of an old signed prompt
after a state transition, display denial, denied export and a successful bypass
export. Prompt replay coverage does not establish durable exactly-once tool
effects. The display case intentionally permits synthetic data to reach the
provider and then suppresses final display; it does not test provider disclosure.

## Observations and reproducibility

The host approves `mcp://reference/allowed` and `mcp://reference/other` aliases
for the pinned child's `read` endpoint, preserving the affinity seeds' exact URIs.
The child logs isolation probes and actual read/export callbacks, with validated
sequence and case correlation. Both adapters independently record decision codes,
provider calls, provider-visible tool messages, final outputs and session versions.
They check local provenance and whether synthetic host authority leaked into
provider inputs. The grader compares complete observations, including JSON types,
against the separate shared expectations. A `passed` bypass cell means that the
synthetic bypass succeeded as expected, not that a security control held.

Every cell embeds the existing [result contract](../schemas/result.schema.json).
The enclosing [matrix schema](../schemas/topology-matrix.schema.json) distinguishes
`passed`, `failed`, `blocked`, `unsupported`, `skipped` and `error`. Missing,
duplicate, malformed or extra adapter results cannot create partial success.

The manifest records the commit, relevant working-tree modification flag, sorted
source-file hashes and aggregate digest, corpus/inventory hashes, runtime versions
and pinned fixture configuration. It omits random session IDs, temporary paths,
timestamps and durations. Identical inputs and runtimes produce identical JSON.
Source changes during execution invalidate observations. Artifacts belong under
ignored `.artifacts/`; CI retains the synthetic manifest for inspection. The
manifest is unsigned and has no independent grader attestation.

Remaining #48 work includes CDL-002 disposition, expanded requirement mappings,
complete Topology C adapters and separately scoped semantic/topology experiments.
The [effectiveness protocol](../evaluation/PROTOCOL.md) and M6 completion gates
remain open.
