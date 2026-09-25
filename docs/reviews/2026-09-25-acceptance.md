# Acceptance reconciliation and normative review, 2026-09-25

Implementation baseline: `79f0cb5`, after PRs #53-#58 reached main. This is an
AI-assisted repository evidence review requested by the project lead. It is not
independent security review, full protocol conformance or normative adoption.

## #37: lifecycle acceptance

The merged opt-in slice meets the four issue criteria within
[Lifecycle 0.1](../../specs/profiles/PSP-LIFECYCLE-0.1.md).

| Issue criterion | Inspected evidence and outcome |
| --- | --- |
| Bounded owner listing, cancellation, expiry and retention contracts | Profile sections Admission, Listing, Cancellation and Retention; shared [HTTP schema](../../schemas/api/lifecycle-0.1.openapi.json) and [MCP catalog](../../schemas/mcp/lifecycle-tools-0.1.json). Lists are owner/tenant/epoch partitioned, use a 1-50 keyset limit and exclude purged records. |
| Host/persistence approval and invalidation | Paired LifecycleStore/LifecycleService implementations reauthenticate, require literal-true grants, compare revisions and retain atomic receipts. Shared cases include `scope-filter`, `cancel-invalidates-handle`, `cancel-invalidates-checkpoint`, `cancel-blocks-commit`, `completed-cannot-cancel` and `revocation-during-authorization`. |
| Retained receipts and CDL conflicts | Purge requires separate retention and persistence approval for all removed payloads and retained tombstones. `retention-denies-purge`, `persistence-denies-tombstones`, `cdl-retention-conflict` and `payload-cleanup-and-replay` cover rejection and replay boundaries. |
| Paired implementations, transports, races and restart | [27 shared cases](../../conformance/vectors/workflows/lifecycle-0.1.json) plus [the integration runner](../../scripts/check-lifecycle-parity.py): actual HTTP/stdio mutations in both language directions, two-way restart/cleanup, update/resume/duplicate-cancel races and injected SQL rollback. Fresh run passed on 2026-09-25. |

Source inspection included both `api-server` lifecycle implementations and both
SQLite lifecycle queries. Cancellation does not undo external effects or supply
distributed fencing. Cleanup is logical payload removal; physical erasure,
backups, epoch retirement and node deletion are outside this slice. These limits
are explicit in the profile. Closing #37 does not close M3 or adopt the API.

## #39: fixture acceptance

The merged fixture slice meets the four issue criteria for repository-owned
synthetic peers within the documented [process boundary](../../evaluation/FIXTURE-SERVERS.md).

| Issue criterion | Inspected evidence and outcome |
| --- | --- |
| Paired benign/adversarial peers and observable effects | `evaluation-server.mjs` / `evaluation_server.py`, shared fixed public canary and synthetic signing material; bounded correlated read/export event logs. |
| Required adversarial and clean controls | [15 shared scenarios](../../conformance/vectors/evaluation/servers-0.1.json): benign read, dispatch/output denial, forged metadata/provenance, discovery drift, malformed/oversized frames, timeout, cancellation before/during a read, signed malicious content, denied export, successful direct bypass and rejected URL arguments. |
| Isolation, bounded I/O and cleanup | Dedicated stdio children with fixed executable/script paths, explicit synthetic environment, no shell/listener, finite event/output/lifetime bounds and finally-path cleanup. Paired `fixture-isolation` helpers block network/process APIs and require observed startup probe events. |
| Deterministic parity and effect measurement | [Integration runner](../../scripts/check-evaluation-parity.py) compares exact reports in all four language combinations. Fresh run passed all 60 process scenarios on 2026-09-25; the bypass exported the synthetic canary as expected. |

Isolation is accident prevention for repository-owned fixture code. It is not an
OS sandbox for arbitrary hostile binaries or native extensions. No model was
called, no effectiveness statistic was computed, and refusal wording was not
used as evidence. Full topology execution and effectiveness remain #48/#49.

## #34: inventory and parser review disposition

The first three acceptance criteria have evidence; final normative disposition
remains open. The [original review](../../specs/reviews/PSP-CDL-REVIEW-0.1.md)
and [register](../../conformance/requirements.json) reproduce all 443 uppercase
keyword occurrences, including 242 MUST/MUST NOT occurrences, with source hashes,
version/line/column/heading and stable IDs. Definitions/examples are explicitly
classified. The 460 conservative requirement entries retain 31 legacy IDs;
five workflow seed cases remain unexecuted.

Every obligation candidate has a provisional component, boundary/profile and an
explicit blocked/unimplemented outcome. All linked profile evidence executes
against both public library adapters. This satisfies an inventory of evidence
and gaps; it does not complete clause splitting, validate every generated
component assignment or discharge a whole RFC obligation. #48 must adjudicate
the particular obligations it executes instead of converting related evidence
into blanket passes.

| Subject | Review outcome |
| --- | --- |
| Structural markup, escapes and resource bounds | Existing Codec 1.0 remains selected; PSP-E007 receives explicit future-edition text in [Parser 0.2](../../specs/errata/PSP-PARSER-0.2.md). |
| Type/attribute grammar, JSON/JCS and Unicode | Retain existing explicit codec/signature selection and its executable cases; no implicit grammar expansion or normalization. |
| Signature alias precedence | PSP-E008 proposes aligning the §24 summary with §17.8.2 and Signature 2.0 strict matched pairs; adoption remains pending. |
| Refresh version and expiry | PSP-E009 proposes host-approved compatible version increases and fail-closed expiry; equal-version mutation and rollback remain rejected. |
| CDL unknown terms, inheritance and negation | Retain finite Deterministic 1.0 behavior and per-origin host grants. Broader semantic matching remains unsupported. |
| Workflow grammar and inference-engine isolation | Explicitly unimplemented/unsupported; parsing, signatures and proxy mediation do not supply these properties. |

The [parser review record](../../specs/reviews/parser-review-0.2.json) identifies
the exact candidate and its public notice. A full comment window and recorded
lead decision are required before adopting PSP-E007-E009 or closing #34. The
review does not revise published baselines or mark any requirement passed.

## #35: API/editorial review disposition

The first three acceptance criteria have evidence. The missing-reference map,
eleven required tool counterparts, eleven exact heading corrections/anchor
aliases and compatibility choices are present in the merged
[API candidate](../../specs/api/RFC-PSP-API-v1_0_0-candidate.md),
[contract index](../../specs/api/contract-set-1.0.0.json) and
[editorial proposal](../../specs/errata/PSP-API-EDITORIAL-0.2.md).

The selected proposal remains a new normative API; reference deletion is the
historical alternative. Host-owned authority, private checkpoint custody,
projected views, encryption ordering, buffered plaintext release and exact wire
migration choices remain proposed under candidate section 7. The candidate and
pinned source contracts are unchanged by this reconciliation.

PR #58 and issue #35 had no review comments, reviews or inline comments when
checked on 2026-09-25. PR #54's sole issue comment requested merge-conflict
resolution; it is administrative, not a normative objection or approval.
This is a snapshot, not a final comment collection or evidence of consensus.

The [API adoption record](../../specs/api/adoption-1.0.0.json) remains
`public-review`, `accepted: false`, with no maintainer decision. Its earliest
adoption is **2026-10-09T13:00:31Z**. Recollect comments and record reasoned
dispositions at closure; substantive candidate changes restart its window.
PSP-E007-E009 have a separate parser review and are not adopted through the API.

## Validation and next decision

Fresh checks passed: lifecycle parity; evaluation parity; requirement extraction
and executed evidence; API review-map generation; API candidate generation.
Existing [CI on the unchanged implementation](https://github.com/realflowmick/psp-cdl/actions/runs/36172562797)
passed Node 22/24, Python 3.12/3.13 and full cross-language parity. Its successful
Linux parity result does not erase the earlier Windows MCP-refresh timeout
recorded in PR #59.

Close only #37/#39 for their scoped implementation acceptance. Keep #34/#35,
milestone trackers, normative adoption and package publication gates open. The
lead's later decision must name the accepted revision, address every substantive
comment and state whether independent review occurred. No future acceptance is
pre-authorized by this record.
