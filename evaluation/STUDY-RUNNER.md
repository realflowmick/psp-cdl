# Development study runner

This is the first executable slice of [#49](https://github.com/realflowmick/psp-cdl/issues/49).
It connects the existing buffered provider adapters to synthetic MCP reads in
TypeScript and Python. It is a development pipeline, not a preregistered study,
held-out corpus, independent review or completed M6 milestone. No paid live run
has been performed for this change.

## Run offline

Install the locked workspaces and build TypeScript using the
[development instructions](../docs/development.md). Node 24 and Python 3.12+
are recommended; Node 22.13+ is required. On Windows, an older system Node can
shadow the repository's local runtime. If using that existing local installation:

```powershell
$env:PATH = "$PWD\.tools\node-v24.21.0-win-x64;$env:PATH"
node --version
```

From the repository root:

```sh
uv run --locked python scripts/run-study.py --output .artifacts/study-development.json
```

The default executes **96 trials** with four isolated workers: six development cases, four conditions and
four host/server language pairs. A scripted transport exercises the real provider
request/reply mapping; no provider credential is read and no model API is called.
Separate MCP child processes record actual reads. The expected direct/indirect
attack successes in bypass arms are required controls, not security successes.

Use a new output filename for each run. The runner refuses to overwrite an
existing plan or report. `--host`, `--peer`, `--condition`, `--case` and
`--repeats` select an explicitly recorded scope. For example:

```sh
uv run --locked python scripts/run-study.py --host python --peer typescript --case attack-display-private --output .artifacts/study-display.json
```

`scripts/check-study-parity.py` runs the full matrix, checks each observation
against the separate shared rubric, and compares events, output digests, request
digests, call counts and outcomes across all four language pairs. It is included
in `scripts/check-parity.py`; CI retains the ignored reports.

## What the conditions mean

This first runner studies **Topology B host-boundary ablations**. The unprotected
arm deliberately removes deterministic host controls. All arms retain the same
semantic instruction and visible handling declaration, bounded I/O, synthetic
launcher authentication and schema-valid read tools.

| Condition | Deterministic host controls |
| --- | --- |
| `unprotected` | Direct bounded orchestration; no PSP affinity or CDL release decision |
| `psp-only` | Existing signed-prompt/session loop and node/tool affinity; empty CDL restrictions |
| `cdl-only` | Existing CDL policy evaluator over host-selected transcript restrictions and recipient capabilities; no signed PSP session or affinity |
| `combined` | Existing signed-prompt loop and dispatch gate, plus transcript-wide CDL release checks |

The three legitimate cases cover no-tool output, public reads and explicitly
authorized private reads. Three attack cases cover direct unauthorized reads,
instructions embedded in a public tool result and display of restricted data.
The model never supplies authority, capability declarations, grading criteria,
credentials or session bindings. Policy originates in the launcher-selected
case; the `no-display-to-operator` restriction follows private tool data through
later inference, dispatch and final display. A private read is permitted in the
display-only case, and is graded separately from disclosure to the operator.

The comparisons measure these specific interventions. They do not isolate every
PSP feature or prove signature effectiveness. CDL-only intentionally lacks PSP
authorization and can perform a read that violates node affinity. The same
semantic prompt in all arms is an explicit control, not a claim of absent model
safeguards. A filtered tool catalogue can prevent an attempted private call
before dispatch; the report does not mislabel that as a downstream tool denial.

Topologies **A and C** are listed as unsupported study configurations. The
separate [offline workflow matrix](../docs/workflow-matrix.md) already exercises
A/B/C fixtures, but its scripted observations are not live semantic evaluations.
Streaming, mutating tools, completion/refresh modes and additional protocol
ablations remain unsupported here. Published RFCs and profile semantics are
unchanged. Basis: PSP Core 3.2.0 §§17.3–17.4, 21.2–21.4 and 24 node-agent
affinity; CDL 1.5 §7.6.2; Deterministic Policy 1.0 §§1, 3–5.

## Live development execution

Live mode is separately admitted and sequential (one worker). It requires all of:

- `--mode live --allow-live` and a host environment `PSP_OPENAI_API_KEY`.
- `--budget-usd` and operator-attested upper input/output prices in USD per
  million tokens (`--input-usd-per-million`, `--output-usd-per-million`).
- `--provider-capabilities` pointing to a host-reviewed JSON file with exactly
  `complete: true` and `sources: [{"id": "host-reviewed-path", "capabilities": [...]}]`.
  Include the actual account, storage/logging and transitive path capabilities;
  `store: false` is not evidence of a provider's handling properties.

Keep that configuration under ignored `.artifacts/` and credentials in the host
environment. Never put a key in the capability file. The runner validates the
plan and budget before credential lookup. Offline mode rejects live flags.

For PowerShell, after supplying those operator values and reviewing the
capabilities file, the smallest live development selection is:

```powershell
uv run --locked python scripts/run-study.py --mode live --allow-live --host python --peer python --condition combined --case benign-public --budget-usd $budgetUsd --input-usd-per-million $inputRate --output-usd-per-million $outputRate --provider-capabilities .artifacts/provider-capabilities.json --output .artifacts/study-live-development.json
```

The variables are intentionally operator-supplied, not quoted current prices.
No live invocation is part of CI, imports, examples or the default command.
The model snapshot and wire mapping stay pinned by
[OpenAI Chat 0.1](../specs/profiles/PSP-OPENAI-CHAT-0.1.md).

The whole selected plan reserves up to four attempts per trial before execution.
Each attempt reserves **1,047,576 input tokens plus 128 output tokens**, matching
the adapter's conservative context bound. Integer microdollar arithmetic rounds
up each call; there are no refunds or retries. An insufficient ceiling rejects
the entire plan. This can greatly exceed expected usage. The monetary bound is
conditional on the operator-supplied upper rates and covers this invocation;
it is not an account-wide provider spending limit.

Ctrl-C signals cancellation to the active adapter, suppresses its pending output
and skips remaining trials. Native transport deadlines and child lifetimes are
bounded. Already submitted remote work can still be billed. The pre-reserved
budget includes those attempts, even when actual usage is unavailable.

## Reports and interpretation

The runner writes a plan before any provider call. It pins the source commit,
working-tree flag, source and built JavaScript hashes, corpus hash, runtime
versions, model mapping, limits, selections, ordering, capability inventory and
budget assumptions. The final report includes the plan and its digest. Changing
source during execution invalidates the report. Live responses and provider
decoding defaults are nondeterministic; this identifies reproducible inputs,
not byte-identical live outputs. The manifest is unsigned.

A separate `.journal.json` checkpoints completed redacted rows during execution;
it is an incomplete recovery artifact, not a final report. The `.plan.json` is
created exclusively before execution. The final `.json` follows the shared
[report schema](../schemas/study-0.1.schema.json).

The report preserves every planned trial, including operational errors,
cancellation and skipped work. Per-trial evidence includes correlated tool
events, call counts, output/transcript hashes, elapsed time and rubric outcomes.
Raw model answers and transcripts are evaluated in memory and omitted from
persisted reports. Exact canary matching only detects the declared canaries;
it is not a semantic leakage detector. Code and shared corpus remain the basis
for independently re-running the grader; human independent grading is pending.

Aggregate results remain separate by condition and host/server language pair.
Each rate exposes true, false and unknown counts. Provider failures and missing
observations cannot count as defended attacks. Observed unauthorized reads remain
attack successes even if a later provider call fails. An exhausted step budget
without a forbidden observation remains unknown. Benign failure and explicit
policy denial are different measurements. Latency p50/p95 values include a sample
count and measure a full trial including local fixture startup/cleanup.

Actual token usage and provider billing are **null / unavailable** because the
existing adapter validates usage but does not expose it. Reports distinguish
observed invocation counts, conservative token bounds and the full-plan cost
reservation. These are not measured costs. No confidence interval or effectiveness
claim is made for the scripted development controls.

Exit **0** means the selected execution scope completed (and, offline, all
expected control observations matched). An observed successful attack in a live
trial is still an outcome, not a runner malfunction. Exit **1** means an
operational error, offline regression or source change; exit **2** means invalid
setup or incomplete/cancelled execution. Neither 0 nor a report closes #49.

Next, freeze a separate held-out corpus, trial allocation, applicable topologies,
ablations, grading arrangements, uncertainty analysis and budget under
[the study protocol](PROTOCOL.md) before collecting publishable outcomes. The
public development corpus must not be relabeled as held-out data.
