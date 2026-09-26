# Offline workflow matrix

The [#48](https://github.com/realflowmick/psp-cdl/issues/48) harness executes the
same [21 scenarios](../conformance/vectors/topologies/matrix-0.2.json) through
paired TypeScript and Python adapters for Topologies A, B and C. It covers all
five original seeds and records partial evidence for 27 requirements alongside
explicit pending dispositions for the entire 460-requirement inventory.

These are offline workflow fixtures with a scripted provider, real MCP child
processes and synthetic data. They establish the observed fixture behavior, not
model compliance, whole-RFC conformance, measured effectiveness or production readiness.

## Run

Install the locked workspaces and build TypeScript using Node >=22 and Python
>=3.12 as described in the [repository setup](../README.md).

```sh
uv run --locked python scripts/run-topology-matrix.py --check --output .artifacts/workflow-matrix.json
uv run --locked python scripts/run-topology-matrix.py --output .artifacts/workflow-matrix.json
```

`--check` exits **0** only when all 324 applicable runs pass. The remaining 12
cells are explicitly unsupported: Topology A has no authoritative PSP session
against which to test tenant substitution, stale state or prompt replay.
Omitting `--check` exits **2** even after fixture success because whole-clause
conformance remains pending. Both modes exit **1** on an observed mismatch or
adapter error. Setup/schema failures also exit nonzero without claiming a run.

`--topology`, `--host`, `--peer` and `--proxy` select subsets; omitted applicable
cells become `skipped` and cannot satisfy `--check`. The matrix is part of
`scripts/check-parity.py`. `npm run conformance` and
`python -m psp_cdl_test_harness` still report `not_implemented` and exit 2.
The 511 library-profile checks remain a separate mode.

## Executable boundaries

| Topology | Process path | Language combinations | Applicable runs |
| --- | --- | --- | --- |
| A | Direct host/provider loop → MCP server | 4 host/server pairs | 72 |
| B | Buffered LLMProxy and host dispatch gate → MCP server | 4 host/server pairs | 84 |
| C | Buffered LLMProxy and host gate → separate MCPProxy → governed server | 8 host/proxy/server triples | 168 |

A is the unmediated orchestration control. It supplies covenant text to a
replaceable host-owned provider callback, but the offline runner uses a scripted
provider. Its observed forbidden reads/exports are expected counterexamples to
deterministic mediation, not measurements of a model's semantic behavior.

B uses the public buffered loop, signed prompts, durable SQLite state and
dispatch gate. C adds a separate gate-backed MCP service with its own pinned
registrations and affinity policy, and a server that evaluates CDL before
releasing tool output. Dedicated cases isolate denial at the host, proxy and
server. The proxy's fixture authority snapshot is independent host configuration;
it is not distributed state coordination or an independence claim about shared libraries.

Each topology also has a deliberately direct export bypass control. C's bypass
retains the server output check but omits both mediation gates. A passed bypass
cell means the synthetic export occurred as expected. It does not mean a
security control held.

Children use the existing repository-owned fixture isolation boundary, bounded
lifetimes and a synthetic credential. There is no network model call or external
export destination. Host-only cleanup registration is never supplied to the model
or dispatch gate. This trusted fixture boundary is not an arbitrary-code sandbox.

## Seeds and requirements

| Seed | Executable mapping |
| --- | --- |
| CDL-001 | Conflicting tool capability; mediated denial before a downstream call |
| CDL-002 | Whitespace splitting and lowercase normalization to `pii`, `no-training` |
| PSP-001 | Exact disallowed agent URI; mediated denial before a read |
| PSP-002 | Allowed URI, actual child read, data observed by provider and final output |
| PSP-003 | Unknown Ed25519 key ID and empty trusted-key set; rejection before inference |

CDL-002 is lexical tokenization under CDL 1.5 sections 4.2 and 4.4. The new
`tokenizeDeclaration` / `tokenize_declaration` API preserves first occurrence
order and supplies no declaration kind, registry authorization or negation grant.
It does not pass the mixed string to a typed policy evaluator. The earlier
classification of this lexical seed as blocked on #34 was too broad. The original
seed, RFC and pending requirement dispositions are preserved; no normative
parser proposal is adopted by executing it.

Additional cases cover array lexical equivalence, forged tool authority,
tenant substitution, cancellation, stale state, prompt replay, tampered and
expired prompts, inference/display/export denial, proxy policy/affinity denial
and server output denial. B exercises transport cancellation after a real read;
C completes the remote exchange and tests host suppression after the proxy
release observation. Replay tests do not establish exactly-once tool effects.
Display denial suppresses final output after provider exposure, not provider disclosure.

The [versioned mappings](../conformance/workflow-mappings-0.2.json) associate 27
requirements with exact cases, topologies, limited assertions and remaining gaps.
Every report accounts for all 460 source requirements, with one pending generic
result per language (920 results). Original `blocked` obligations stay blocked;
`unimplemented` obligations report unsupported whole-clause execution. Passing
fixture references never promote either to whole-clause success. Requirements
without mapped cases remain visible. Review #34 and further implementation work
are still required for complete normative coverage.

## Observations and reproducibility

The host pins the exact `mcp://reference/allowed` and `mcp://reference/other`
identities. Separate server/proxy logs record real callbacks and output decisions
with validated sequence and case correlation. Adapters record decision codes,
lexical terms, provider calls/tool messages, final output and session versions.
They check provenance and synthetic host-authority markers in provider inputs;
this finite check is not exhaustive confidentiality verification.

The grader compares complete observations, including JSON types, with separately
authored expectations. Missing, duplicate, malformed or extra results cannot
create partial success. Each cell embeds the shared [result contract](../schemas/result.schema.json).
The [version 0.2 schema](../schemas/topology-matrix-0.2.schema.json) distinguishes
passed, failed, blocked, unsupported, skipped and error. The original 0.1 corpus
and schema remain historical artifacts.

The unsigned manifest records the commit, relevant working-tree modification
flag, sorted source hashes and aggregate digest, corpus/inventory/mapping hashes,
runtime versions and pinned fixture configuration. It omits random session IDs,
temporary paths, timestamps and durations. Identical inputs and runtimes produce
identical JSON; changes to tracked source inputs during execution invalidate the
observations. Generated artifacts belong in ignored `.artifacts/`, and CI retains
the manifest. The [effectiveness study (#49)](../evaluation/PROTOCOL.md), signed
results, independent grading and M6 completion gates remain separate work.
