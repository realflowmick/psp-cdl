# Joint PSP/CDL development validation

The harness and opt-in context provider transcripts were delivered in
[PR #82](https://github.com/realflowmick/psp-cdl/pull/82), merged 2026-09-30;
[#81](https://github.com/realflowmick/psp-cdl/issues/81) is closed. Model observations,
semantic review and remaining integration work continue under
[#7](https://github.com/realflowmick/psp-cdl/issues/7). The bounded harness wraps the
merged [context/service integration](context-service.md).
It runs six synthetic cases through actual TypeScript or Python `ContextLlmLoop`
instances, SQLite state and authorized services. The model chooses the branch.
Expected outcomes are checked after execution and never select runtime nodes.

The shared cases cover natural-language routing, expression-first routing,
denied writes, a CDL persistence conflict, checkpoint/resume and post-commit
reconciliation. They are partial variants of five existing review scenarios.
Every report inventories all 68 originals: five have related fixtures and 63
are not wired. None of the original scenarios is discharged by these variants.
Their source statuses and the 460-requirement register remain unchanged.

## Prepare and rehearse

Use the repository's supported Node/Python runtimes and installed dependencies.
From the repository root:

```sh
uv run --locked python scripts/joint_interpreter.py prepare --output .artifacts/joint-bundle.json
uv run --locked python scripts/joint_interpreter.py inspect --bundle .artifacts/joint-bundle.json
uv run --locked python scripts/joint_interpreter.py run --bundle .artifacts/joint-bundle.json --language typescript --output .artifacts/joint-ts
uv run --locked python scripts/joint_interpreter.py run --bundle .artifacts/joint-bundle.json --language python --output .artifacts/joint-py
```

Preparation builds TypeScript and pins both source and loaded JavaScript, the
Python implementation, both instruction candidates, selected profiles, the full
synthetic application, cases, schemas, review indexes and dependency lockfiles.
Text hashes normalize line endings. `--case natural-language` can select a smaller
bundle; repeat `--case` to select more. Outputs are created exclusively and never
overwrite earlier evidence. Run directories must be inside ignored `.artifacts`.
Use new names for subsequent bundles/runs.

Each case uses a fresh synthetic host and temporary database. The fixture clock
is deliberately fixed at 1000; this suite does not validate real-time expiry.
Provider transport timeouts and an outer worker timeout bound real elapsed time.
Only synthetic data is supported. Public fixture signing keys and test identities
must never be reused for a real application. Observation capture is test-host
instrumentation, not an implementation of governed production logging.

Rehearsal exercises the real buffered provider mapping with a synthetic offline
transport, scripted replies and synthetic usage counts; it makes no network calls. Its successful status
is `rehearsal-passed`; semantic behavior remains `not-run`. Failed expectations,
source changes, worker errors, cancellation and unrun cases retain distinct
records. Source changes stop subsequent cases, including when detected after the
last worker. A killed/crashed coordinator may leave only individual case files;
an absent final report is incomplete evidence, never a pass.

## Evidence and grading

Each observation records the exact model-visible requests and visible responses,
actual service receipts or sanitized error codes, released answers, final durable
state and available usage counts. Host credentials, signing material and private
resume tokens are excluded from model input. The capture records requests before
the provider mapping; it is not a raw HTTP capture or hidden model reasoning.
Rubrics and expected grades remain outside the provider request.

Paired graders check branch/state agreement, retained governance and reconstruction
fields, write/resume counts, actual denial feedback, checkpoint pause/reconstruction,
and preservation of the post-commit failure. Recovery explicitly re-reads state
before a new invocation; it does not replay the failed mutation. A successful
boundary grade cannot establish that an explanation is truthful, a transition
interpretation is semantically correct, or all relevant state was retained.
Those questions require review of the transcript and case rubric.

`report.json` binds each observation by SHA-256 and retains its bundle digest.
These are local integrity references, not signatures or independent attestations.
To record semantic review of live observations, create a JSON review containing:

```json
{
  "reportSha256": "<SHA-256 of the exact report.json bytes>",
  "reviewer": "<reviewer identity>",
  "decisions": [
    {
      "caseId": "natural-language",
      "verdict": "pass",
      "rationale": "<assessment against every case rubric item>",
      "evidence": [{"collection": "trace", "index": 0}]
    }
  ]
}
```

Include exactly one decision for every selected case. Verdicts are `pass`, `fail`,
`blocked` or `uncertain`; references point to zero-based `trace`, `services` or
`outputs` entries in that case's observation. Then run:

```sh
uv run --locked python scripts/joint_interpreter.py review --run .artifacts/joint-live --review .artifacts/joint-review.json
```

The recorder rechecks pins, bundle/report bindings, evidence hashes, case inventory,
reference bounds and automatic grades. It rejects promotion of scripted evidence
and cannot override a failed boundary check with a pass. It records the supplied
reviewer attestation without authenticating identity or asserting independence.
It never edits the original scenario register or claims clause conformance.

## First bounded observation

Selected next work under #7, reconciled 2026-10-03: run only `natural-language`
through Python, inspect its actual model decisions and service effects, and record
semantic review before expanding live cases. The configuration has passed offline
rehearsal; no live observation or semantic pass is recorded. Actual API project
and capability inventory and a host-supplied credential remain pending.

| Setting | Selected bound |
| --- | --- |
| Case / implementation | `natural-language` / Python |
| Model / transcript profile | `gpt-4.1-mini-2025-04-14` / `PSP-OPENAI-CONTEXT-0.1` |
| Provider calls / output | At most 2 calls; 1,024 output tokens per call |
| Token reservation | 2,097,200 total; a conservative reservation, not expected usage |
| Request / response | 131,072 / 16,384 bytes per call |
| Time limits | 15 seconds per provider attempt; 60 seconds per worker |
| Data / effects | Public synthetic fixture and temporary local SQLite state |

Prepare with `--case natural-language`, then make a new bundle copy with
`provider.limits.maxCalls: 2`, `budgetTokens: 2097200`, `maxOutputTokens: 1024`,
`maxRequestBytes: 131072`, `maxResponseBytes: 16384`, `timeoutMs: 15000`, and
`workerTimeoutSeconds: 60`. Keep each bundle and run under ignored `.artifacts`;
retain earlier evidence. Run `inspect` and an offline rehearsal with that exact
configuration. These are selected first-run bounds, not changes to CLI defaults.

Before live execution, identify the actual project and its account/transitive
capabilities, including training, logging, retention and downstream processing.
The fixture carries `no-training`; synthetic data does not waive that covenant.
Review the applicable [PSP interpretation decisions](psp-interpreter.md#open-interpretation-and-integration-decisions)
and [CDL profile boundaries](cdl-interpreter.md#profile-selections-and-remaining-decisions)
against the selected application. Keep `provider.complete: false` until the real
inventory is established. Supply the API credential only through the host
environment. Inspect the completed bundle and use its resulting digest for the
explicit live invocation below; an earlier incomplete bundle is not admitted.

Assess the visible transcript and case rubric alongside actual receipts and
durable state: the model must interpret the applicable condition, preserve
variables/evidence/governance, and claim only receipt-confirmed effects. A passing
boundary grade still needs semantic review. Preserve failures and unknown effects;
do not automatically repeat a paid attempt or replay a mutation. Correct observed
defects before adding the other development cases and paired model observations.
This case remains a partial variant of `psp:context-ownership`; it cannot discharge
that original scenario or the 460-requirement register.

## Separately admitted live execution

No live model run is part of the harness implementation or CI. The existing
[buffered provider adapter](llm-provider.md) pins the model and TLS endpoint.
Both worker modes explicitly select the [context transcript profile](../specs/profiles/PSP-OPENAI-CONTEXT-0.1.md),
which preserves the state/receipt and assistant-text messages required by the loop.
The original provider adapter default remains unchanged.
Preparation leaves provider `complete: false` with an empty source inventory.
Before live execution, review the exact bundle, populate actual account/transitive
capability sources, explicitly accept completeness, and select call/token/time
limits. An empty or incomplete inventory cannot admit a live run. The harness
does not infer retention/training guarantees from a provider name or `store:false`.

`inspect` returns the resulting digest. Supply the key through `PSP_OPENAI_API_KEY`
in the host environment, then explicitly select one language:

```sh
uv run --locked python scripts/joint_interpreter.py run --bundle .artifacts/joint-bundle.json --mode live --allow-live --approved-digest <reviewed-digest> --language python --output .artifacts/joint-live
```

Live admission happens before workers start or credentials are read by an adapter.
Calls are bounded per isolated case and the report shows the aggregate ceiling.
Defaults permit six calls and 1,024 output tokens per case, 15 seconds per provider
attempt and 120 seconds per worker. The adapter conservatively reserves
1,047,576 + output-limit tokens per attempt; reservation is not expected usage or
a dollar estimate. Hosts retain monetary/account-wide budget responsibility.
Cancellation cannot undo requests already received by the provider.

A live run with passing boundary checks remains `needs-review` and exits 2.
Its model observations require semantic review; no automatic text matcher upgrades
them to success. Effectiveness study #49, full conformance, independent security
review and package publication retain their separate gates.

## Validation and remaining implementation

```sh
uv run --locked python scripts/generate-interpreter-validation.py --check
uv run --locked python scripts/check-interpreter-parity.py
```

The language suites run all six rehearsals and negative grading checks. Full parity
runs both hosts and exchanges their observations with both graders. Additional
checks reject missing/wrong live admission, source inventory drift and attempted
promotion of rehearsal evidence.

Next extend exact fixtures across the remaining review scenarios, resolving host
completeness and profile decisions as needed. Nested applications, remaining
security/lifecycle service forms, automatic refresh, completion composition,
streaming and remote mutating effects remain outside this first harness slice.
