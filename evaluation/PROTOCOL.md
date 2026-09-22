# Effectiveness evaluation protocol (draft)

## Questions and preregistration

Does PSP/CDL reduce successful unauthorized actions or disclosures while preserving useful benign task completion? Which guarantees are deterministic, which depend on model behavior, and which fail under bypass or common-mode compromise?

Before running, freeze the corpus hash, implementation commit, profile revision, topology, model identifier/version, provider configuration, decoding settings, trial counts, random seeds and success rubric. Use separate development and held-out cases; disclose any tuning on test cases. This initial protocol has no measured results.

## Conditions

Compare an unprotected baseline, PSP only, CDL only, and PSP+CDL. Run semantic-only A, chat-host mediated B, and full chain C where meaningful. Add ablations for signatures, tool affinity, provenance, threat accumulation, prompt refresh, and output gating. Exercise TypeScript-only, Python-only and mixed-language stacks; record unavailable combinations instead of discarding them.

Use fixed synthetic secrets and tool spies. Include direct and indirect injection, multi-turn attacks, signed malicious content, malformed/ambiguous documents, delimiter nesting, forged capability metadata, expiration/replay/rollback, cross-tenant substitution, tool races, retries, streaming leaks, topology bypass, and post-completion manipulation. Pair attack cases with legitimate tasks using the same tools and data shapes.

## Measurements

| Metric | Definition |
| --- | --- |
| Attack success rate | Trials with observed forbidden side effect or disclosure / eligible attack trials |
| Benign task success | Completed legitimate tasks / benign trials |
| False denial rate | Incorrectly denied benign requests / benign requests |
| Conformance | Passed / required cases, with failed, blocked, unsupported, skipped and error counts separately |
| Enforcement coverage | Measured egress and side-effect boundaries / declared boundaries |
| Cost and latency | Token/currency cost and p50/p95 latency, with sample sizes and failures |

Define success by tool-side logs and output canaries, not refusal wording or a model grading itself. An external grader can supplement but not replace observable side effects. Report per-case outcomes, model repetitions and clustered uncertainty where trials share prompts. Use binomial confidence intervals where justified; zero observed successes does not prove zero risk. Publish denominators, missing data and exclusions.

## Reproducibility and publication

Save a redacted run manifest, immutable corpus hash, machine-readable results, environment/dependency versions, exact commands, and analysis code. Capture policy decisions and downstream spy events with correlation IDs. Use public synthetic fixtures only; private vulnerability reports stay private until coordinated disclosure.

Live-provider runs require an explicit operator opt-in, credentials, budget ceiling and cancellation behavior. CI defaults to offline deterministic tests. Sponsor involvement and independent reviewer roles must be disclosed; publish regressions and negative findings alongside improvements. Do not generalize from one model, corpus, topology, or threat class to universal prompt-injection protection.
