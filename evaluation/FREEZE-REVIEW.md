# Topology B pilot freeze review

Status: **preparation only; no appointed independent reviewers, held-out corpus,
collection approval or study outcomes are recorded here.** This brief organizes
the remaining work for [#49](https://github.com/realflowmick/psp-cdl/issues/49).
It does not change the [pilot proposal](PREREGISTRATION.md), its allocation,
runtime contracts or the separate parser/API adoption reviews.

## Review scope and available evidence

The proposed pilot has 12 attack/benign pairs, four in each of three families,
five repetitions, four control conditions and four host/server language pairs:
1,920 trials and at most 7,680 provider attempts. Its scope is buffered Topology B.
The proposal lists unavailable topologies, modes and ablations; completing this
pilot alone cannot close M6.

The supporting implementation is merged through
[PR #66](https://github.com/realflowmick/psp-cdl/pull/66), main commit
`5d35c42b8f5820f4b9af85155f52223d0a892a74`:

| Material | What a reviewer can check | Remaining limitation |
| --- | --- | --- |
| [Pilot planner and analyzer](PILOT-TOOLS.md) | Exact ordering, paired contrasts, unknown-outcome bounds and bootstrap calculation; 25 shared cases and 1,920 synthetic metadata rows | Language agreement does not establish statistical suitability or independence |
| [External-corpus executor and grading](HELDOUT-EXECUTOR.md) | All four language pairs, 96 public scripted rehearsal trials, 25 grading cases, saved effects and complete regrading | These public fixtures are not the held-out corpus; exact canary matching has limited semantic coverage |
| [Signed results](SIGNED-RESULTS.md) | Artifact inventory, host-owned run-scoped trust and signing in both language directions | Valid signatures do not establish observation truth, reviewer identity or collection approval |
| [Offline reproduction audit](RESULT-AUDIT.md) | Reproduction of outcomes, grading and analysis from authenticated saved evidence | Does not rerun trials or reproduce usage/latency; invalid source status remains invalid |

## Remaining evidence and responsibility

The [readiness candidate](study-candidate.json) contains eight evidence slots.
Only the signed-result contract is currently pinned. The other seven stay empty
until their actual artifacts are available. Roles below are work assignments to
be made, not appointments; the [maintainer register](../MAINTAINERS.md) records
the current people and authority.

| Evidence slot | Responsible role | Deliverable and review questions |
| --- | --- | --- |
| `held-out-corpus` | Independent corpus custodian | Separate synthetic corpus, matching pair metadata and provenance statement. Are all 12 pairs distinct, paired inputs equivalent, prior exposure disclosed and cases held out from implementation/prompt tuning? |
| `held-out-executor-validation` | Implementation owner, with reviewer assessment | Source/runtime/lockfile pins, commands, exit codes and public rehearsal evidence. Do observed effects, interruption recovery, ordering and paired regrading agree? Record the limits of scripted controls. |
| `analysis-validation` | Independent method reviewer, supported by implementation owner | Reproduction evidence plus a recorded assessment of pair-level clustering, missing outcomes, exploratory intervals, multiplicity and sample-size limitations. Software parity alone is insufficient. |
| `independent-grading` | Independent rubric/outcome reviewer | Corpus-bound rubric review, disclosed relationship to sponsor/implementers, and a plan for reviewing redacted evidence after collection. Assess exact-answer/canary coverage and how disagreements will be recorded. |
| `ordered-trial-plan` | Evaluation owner | Exact plan from the supplied corpus's pair/case IDs, proposed allocation and seeds. Confirm every case and condition, all 1,920 rows and the complete frozen order. A public synthetic plan cannot fill this slot. |
| `operator-live-admission` | Named execution operator | Reviewed provider capabilities, current upper price rates, sufficient cost ceiling, cancellation procedure and final approval bound to the exact execution bundle. Keep credentials in the host environment. |
| `preregistration-decision` | Project lead / authorized maintainer | Recorded decision after independent review, binding actual corpus, plan and protocol hashes and referencing the reviewed method, source/runtime pins, budget and unavailable combinations. |

Readiness checks file presence and hashes only. Even a result of
`ready-for-maintainer-review` does not authenticate these claims, appoint a
reviewer, approve collection or establish effectiveness. The corpus and rubric
statements accepted by the executor are also host-supplied attestations, not
proof of independence. Record the substantive decisions separately.

## Preparation and decision order

1. Appoint the corpus custodian and rubric/method reviewers through the project's
   governance process. Record identities, sponsor/implementer relationships and
   prior exposure. Keep actual corpus and review inputs outside worker/model
   inputs, except for the selected case input passed by the executor.
2. Obtain the separate corpus and its metadata request. Generate the ordered
   plan with both existing pilot CLIs and compare their output. Validate the
   corpus against that plan with `validateHeldoutCorpus` /
   `validate_heldout_corpus`. Retain exact file hashes for readiness and canonical
   object digests for executor bindings; those hashes are not interchangeable.
3. Assemble the offline validation evidence below for the intended source and
   runtime. Ask reviewers to assess the actual corpus, rubric, method and
   limitations. Record dispositions, including objections and required changes.
4. Obtain the operator's capability, rate and budget inputs. Confirm the full
   reservation, evidence retention and cancellation procedure. Select a clean,
   reviewed source commit and fixed runtime/lockfiles before the collection
   decision; do not substitute a later unreviewed build.
5. The maintainer records preregistration after review. Then use the documented
   `run-heldout.py prepare --mode live` command with the approved corpus,
   rubric and preregistration statements. Preparation binds source/runtime,
   plan, corpus, provider, budget and protocol without reading credentials or
   executing trials. Compare its pins with the reviewed decision.
6. The operator reviews the concrete prepared bundle and records admission for
   its exact `bundleSha256`. This final admission necessarily follows bundle
   preparation; it cannot be supplied before that digest exists. Assemble a
   local candidate copy with the actual evidence paths/hashes and rerun the
   readiness inventory. Record human review independently of its exit code.
7. Collection requires the separately admitted bundle, explicit live opt-in and
   host-owned credentials. Changes to the reviewed scope or pins require a
   recorded amendment, refreshed bindings and admission before collection.

Keep generated plans, corpus files, attestations, validation logs and local
candidate copies under ignored `.artifacts/` paths. Do not commit secrets or
generated output. The executor pins all files under `evaluation/`; changing
that directory after preparation invalidates the bundle. Updating a local
candidate copy under `.artifacts/` avoids changing the frozen protocol inventory.

## Offline validation handoff

On the intended source commit, with locked dependencies installed:

```sh
npm run check
uv run --locked python -m unittest discover -s implementations/python/tests -v
uv run --locked python scripts/check-parity.py
uv run --locked python scripts/check-study-readiness.py
```

Full parity already calls the pilot, held-out executor and result checks; do not
rerun the 96-trial rehearsal merely to duplicate the same evidence. It produces
ignored directories with these review inputs:

- `.artifacts/pilot-parity-*/`: matching TypeScript/Python plans, synthetic
  outcomes, analyses and `validation.json` for the proposed allocation.
- `.artifacts/heldout-parity-*/`: public rehearsal plan and pinned bundle.
- `.artifacts/heldout-runs/<bundleSha256>/`: all 96 public trial records,
  observations, tool effects, grading, outcomes, analysis and manifest.
- The parity log includes result-signing and offline reproduction-audit checks.

Capture the exact commit, tracked diff status, Node/Python/uv versions, lockfile
hashes, commands, start/end times, exit codes and SHA-256 hashes of saved logs
and generated artifacts. Preserve all failures and unsupported outcomes.
An unsigned local inventory supports handoff; it is not a signed study result
or reviewer approval. Reviewers should rerun the relevant commands themselves.

For the unchanged checked-in candidate, readiness is expected to exit 2 with
`incomplete`, `executionAuthorized: false` and seven missing-evidence items.
Report that as an unmet study gate, not a passing validation. No provider call
or paid live trial is needed for this preparation.

## Decisions to record before collection

- Custodian, rubric reviewer and method reviewer appointments and disclosures.
- Corpus provenance, rubric/method dispositions and approved limitations.
- Reviewed source/runtime/lockfile, plan, corpus and protocol pins.
- Operator budget/capability review, then exact-bundle admission.
- Maintainer preregistration decision and any subsequent amendments.

All are pending in this brief. The published baseline specifications, API/parser
comment windows, independent release review and disabled package publication
remain governed by their existing records.
