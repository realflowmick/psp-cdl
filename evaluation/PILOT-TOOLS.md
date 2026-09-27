# Offline pilot planning and analysis

The [Topology B proposal](PREREGISTRATION.md) now has matching TypeScript and
Python tools for ordering trial metadata and analyzing supplied outcome labels.
They perform no provider calls and authorize no execution. This is a draft
analysis method awaiting review, with public synthetic test inputs. It does not
freeze the study or establish effectiveness, corpus independence or grading
accuracy. The separate [development runner](STUDY-RUNNER.md) does not execute
these plans.

## Reproduce the synthetic checks

From the repository root, after building TypeScript and syncing Python:

```sh
npm run build
uv sync --locked --all-packages
uv run --locked python scripts/generate-pilot-contract.py --check
uv run --locked python scripts/check-pilot-parity.py
```

The parity check compares complete plans and analyses in both directions,
exercises 25 shared analytical/rejection cases, then verifies the full proposed
allocation: 12 synthetic pairs, five repetitions, four conditions and four
language pairs (1,920 metadata rows), with 10,000 bootstrap resamples. It retains
canonical JSON under `.artifacts/pilot-parity-*/`; CI uploads those synthetic
artifacts. Identical bytes across implementations show software agreement, not
independent scientific validation. The ordinary suites also check that repeating
identical observations does not create new clusters or narrow intervals.

Create a draft metadata plan with either CLI, choosing a new output filename:

```sh
node scripts/pilot.mjs plan --request conformance/vectors/evaluation/pilot-request-0.1.json --output .artifacts/pilot-ts-plan.json
uv run --locked python scripts/pilot.py plan --request conformance/vectors/evaluation/pilot-request-0.1.json --output .artifacts/pilot-py-plan.json
```

Given a separately prepared outcome file matching every planned row:

```sh
node scripts/pilot.mjs analyze --plan .artifacts/pilot-py-plan.json --outcomes .artifacts/pilot-outcomes.json --output .artifacts/pilot-ts-analysis.json
uv run --locked python scripts/pilot.py analyze --plan .artifacts/pilot-ts-plan.json --outcomes .artifacts/pilot-outcomes.json --output .artifacts/pilot-py-analysis.json
```

Outputs must be new `.json` files within the repository's real `.artifacts`
directory; existing files are never overwritten. Inputs use the core's strict,
bounded JSON parser (including duplicate-key rejection), with a 4 MiB byte limit.
Success exits 0, rejection exits 2. No credential or capability file is read.

The installed `test-harness` libraries export `createPilotPlan`, `analyzePilot`,
`pilotDigest`, `PilotError` in TypeScript and `create_pilot_plan`, `analyze_pilot`,
`pilot_digest`, `PilotError` in Python. They accept ordinary JSON-compatible
objects and return ordinary objects; they do no filesystem or network I/O.
`PilotError.code` is one of `INVALID_REQUEST`, `INVALID_MANIFEST`,
`LIMIT_EXCEEDED`, `INVALID_PLAN`, or `INVALID_OUTCOMES`. The CLI also reports
`INVALID_INPUT_OR_OUTPUT` for I/O failures. A schema validates structural shapes;
the libraries enforce cross-field relationships and exact trial membership.

## Plan contract 0.1

The separate [schema](../schemas/pilot-0.1.schema.json) defines `request`, `plan`,
`outcomes` and `analysis` under `$defs`. It does not replace study report 0.1/0.2
or change any PSP/CDL normative semantics. Shared metadata fixtures and schemas
are CC0-1.0; tools, tests and this guide are Apache-2.0.

Requests contain only pair IDs, attack/benign case IDs, one of the three proposed
families, equal pairs per family, repetitions, two seeds and resample count.
Provenance is `synthetic-fixture` or `unreviewed-input`; neither attests a held-out
corpus. The manifest contains metadata, not attack prompts or synthetic records.
IDs are ASCII lowercase letters, digits, hyphens or underscores, start with a
letter/digit, and have at most 64 characters. All pair IDs and all case IDs are
unique within their respective sets.

The implementation accepts 1–8 pairs per family, 1–20 repetitions and 200–10,000
resamples, but rejects allocations exceeding 4,096 trials. Seeds are integers
from 1 through 2,147,483,647. The proposed allocation uses four pairs per family,
five repetitions and 10,000 resamples; smaller limits support software tests
and do not amend that proposal.

Pairs are sorted by ID. The complete Cartesian product contains both case kinds,
all four conditions and both host/server languages for every repetition. Trial
IDs are `caseId/condition/host/peer/repeat`. Each trial is Topology B.

`sha256-sort-0.1` orders trials by the ascending hexadecimal SHA-256 of the ASCII
string `PSP-PILOT-ORDER-0.1\n{orderSeed}\n{trialId}`, with no trailing newline;
ties use trial ID order. This fixes a pseudorandom order independently of input
manifest order and outcomes. It does not set a provider seed or imply repeatable
model sampling. The proposal's order seed is 492026.

All object digests use SHA-256 over UTF-8 RFC 8785 canonical JSON from the shared
core, with no trailing newline. Plans bind the normalized request and complete
ordered trials, and always state `status: draft`, `executionAuthorized: false`
and `fullStudy: false`. Analysis regenerates the entire expected plan; merely
reordering trials and recomputing a checksum cannot pass validation. These
hashes detect inconsistent inputs, not malicious replacement of an entire plan.

A frozen executable plan still needs reviewed corpus/provenance, implementation
and runtime/lockfile pins, model and decoding settings, evidence/redaction and
grading contracts, admission/budget, a signed result manifest and the recorded
preregistration decision. The [readiness candidate](study-candidate.json) keeps
those evidence slots empty. No metadata plan is substituted for them.

## Outcome labels and missingness

An outcome file contains `schemaVersion: 1`, the digest of the entire plan,
matching provenance, and exactly one row per trial in plan order. Missing,
extra, duplicate or reordered rows are rejected. Use explicit `skipped` rows
for trials never attempted; no denominator is silently reduced.

Every row has `trialId`, `status`, `attackSuccess`, `benignSuccess` and
`falseDenial`. Metrics are Boolean or null; irrelevant metrics must be null.
Attack `observed` rows require a Boolean union-of-forbidden-effects label.
An `error` or `cancelled` attack may retain true for an already observed effect,
or null for unknown; false is rejected. `skipped` attacks must be null. Benign
`observed` rows require both utility and false-denial Booleans, which cannot
both be true. Both false represents an observed unsuccessful task without an
established false denial. Non-observed benign rows have both labels null.

This analyzer consumes labels; it does not observe tools, grade model text,
authenticate reviewers, or retain the underlying side-effect/disclosure split,
latency or usage evidence. A future reviewed executor/grading adapter must
produce these labels from the richer evidence required by the proposal and
retain that evidence separately. It must use unknown for incomplete evidence.

For every metric and condition, report true/false/unknown/total counts,
`rateAmongKnown` (null when no labels are known), and bounds `true / total` and
`(true + unknown) / total`. Status totals and family counts are retained for each
host/server group. No groups are pooled.

## Paired cluster method 0.1

Each case pair is a cluster. Resample all pairs with replacement, retaining every
repetition, both task kinds and all conditions within the selected pair. Reuse
the same draw indices for all metrics, contrasts and language groups. Paired
resampling preserves the relationship between conditions; see the primary
[SciPy bootstrap documentation](https://docs.scipy.org/doc/scipy/reference/generated/scipy.stats.bootstrap.html)
for paired sampling and percentile interval definitions. This implementation
has no SciPy dependency and uses the explicit algorithms below.

With N pairs in sorted ID order and analysis seed 492027, begin counter at zero.
For each candidate index, hash the ASCII string
`PSP-PILOT-BOOTSTRAP-0.1\n{analysisSeed}\n{counter}` (no trailing newline), then
increment the counter. Interpret the first four digest bytes as an unsigned
big-endian word. Reject words at or above `2^32 - (2^32 mod N)`; otherwise take
`word mod N`. Each draw contains N accepted indices. The counter continues
across draws. `resampleIndicesSha256` hashes the concatenation of canonical JSON
for each index array followed by one LF byte, permitting exact interchange.

For every metric, estimate combined minus each of the three controls. For
cluster i, let T denote true counts, U unknown counts, A combined and B control.
With R repetitions per case, the full-plan difference bounds are:

```text
lower = sum_i(T_Ai - T_Bi - U_Bi) / (N * R)
upper = sum_i(T_Ai + U_Ai - T_Bi) / (N * R)
```

Every bootstrap draw substitutes its sampled cluster indices into these sums,
with the same denominator N × R. Integer counts are accumulated before division.
Sort each bound estimator's B draws. Its two reported percentiles are elements
`ceil(B / 40)` and `ceil(39 * B / 40)`, using one-based ranks and no interpolation.
`degenerate` is true only when the complete resample distribution is constant.
Known-only differences are descriptive and receive no bootstrap interval.

The two intervals describe separate bound estimators. They are not a calibrated
95% interval for a partially identified effect, and they have no simultaneous
or multiplicity-adjusted coverage guarantee. The method is exploratory, assumes
case pairs are appropriate independent sampling units, and does not model
provider drift or establish generalization beyond the sampled attack designs.
Family counts are reported without family intervals. Repeated calls and the
four language pairs do not increase the number of independent clusters. Few
clusters, degenerate intervals or zero observed attacks cannot establish zero
risk. Independent methodological review remains a freeze gate.
