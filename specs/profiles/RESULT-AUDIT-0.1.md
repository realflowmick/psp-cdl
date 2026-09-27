# Result Reproduction Audit 0.1

Status: **project draft**, opt-in evaluation artifact contract. License: CC0-1.0.

This offline M6/#49 check supplements [Signed Result Manifest 0.1](RESULT-MANIFEST-0.1.md).
It changes no published PSP/CDL baseline, signature semantics, executor format or
study approval gate. Its structural companion is the
[report schema](../../schemas/result-audit-0.1.schema.json).

## Inputs and trust

The inputs are a signed envelope, independently supplied host verification policy
and a bounded synchronous artifact reader. Authenticate the envelope using the
signed-result contract before reading artifacts. Verify the complete inventory,
exact byte lengths/hashes and original run bindings. Never discover trust keys
from the evidence. Parse JSON with the core bounded reader, retaining rejection
of duplicate names, BOMs, invalid Unicode and unsafe numbers.

The audit snapshots each artifact once and uses detached bytes for all subsequent
work. The signed inventory may total at most **64 MiB**, with the existing 4 MiB
per-file limit; larger inputs are explicitly unsupported (`AUDIT_LIMIT_EXCEEDED`)
before artifact access. This additional audit limit does not alter signing or
signature-only verification. Filesystem callers must supply a quiescent directory;
repository CLIs retain the existing ordinary-file and complete-inventory checks.

Only `heldout-execution-0.1` bundles with valid pilot plans and normalized held-out
corpora are supported. Library checks cover the plan, corpus and fields used by
this calculation, not every execution/admission field. Repository CLIs also
validate the original executor manifest schema. No bundled source, worker, tool,
provider, signing key or credential is invoked or loaded as executable code.

## Evidence reconstruction

Walk the exact pinned trial order and its zero-based four-digit file indices.
Reject indices outside the plan, evidence for unstarted trials (including event
logs), and non-prefix execution histories. Markers must contain only matching
`trialId` and finite numeric `startedAt`. Times are recorded observations, not
trusted clocks; this audit does not enforce the executor's recovery waiting period.

For each started trial, select evidence using the executor's precedence:

1. Use its saved `record.json` if present, requiring a valid matching trial record
   whose completion is not `skipped`.
2. Otherwise use the matching `observation.json` wrapper as returned evidence.
3. Otherwise synthesize an error record from recoverable partial event reads.
4. Unstarted trials become skipped records with no observation or reads.

For partial events, consider only newline-terminated JSON lines. An incomplete
last line is ignored. A valid prefix has one isolation-probe event followed by
at most three public/private read events, with contiguous sequences and matching
trial correlation. Malformed/unavailable prefixes supply no reads; they never
prove absence of an effect. A selected record takes precedence over auxiliary
observation/event files; this audit does not independently corroborate it against
those files. All files remain authenticated even when unused in the calculation.

Use the installed paired `observable-exact-0.1` grader and pilot analyzer to
recompute outcomes, grading details and analysis from these reconstructed records.
Do not use the saved outcome labels as analyzer input. Preserve all planned trials,
unknowns and observable negative effects after errors/cancellation. Compare each
saved document with its reproduced document by SHA-256 of RFC 8785 canonical JSON.
Different JSON formatting alone is not a reproduction mismatch; its exact bytes
were already checked against the signed manifest.

## Report and failure meanings

Reports have scope `result-reproduction-audit-0.1` and schema version 1. They bind
to the canonical signed-envelope hash and the bundle, plan and corpus hashes.
`mode`, `runStatus` and `recovered` retain their signed values. `signatureVerified`
and `artifactsVerified` are true only after successful authentication/integrity
checks. `trials` counts every planned trial; `evidenceSources` counts record,
observation fallback, partial fallback and skipped selections, summing to `trials`.

`checks` contains exactly three entries in this order: `outcomes.json`,
`grading.json`, `analysis.json`. Each has `savedSha256`, `reproducedSha256` and
`matches`. Report status is `reproduced` iff all match, otherwise `mismatch`.
No raw evidence, prompts or responses appear in the report. Rejected inputs do
not receive a successful audit report. Errors retain signed-result/pilot codes;
new codes are `AUDIT_LIMIT_EXCEEDED`, `UNSUPPORTED_AUDIT_BUNDLE` and
`INVALID_AUDIT_EVIDENCE`.

`notAudited` always names worker-observation truth, usage/latency summaries,
source reexecution and study readiness. Reproduction uses the installed library
version, not an execution of the source commit pinned by the run. Record that
auditor revision/runtime separately when archiving a review. The report itself
is unsigned and is not independent review. `fullStudy`, `independentReview` and
`executionAuthorized` remain false. In particular, a reproduced result whose
`runStatus` is `invalid-source-changed` remains invalid for study use.
