# Progress and actionable backlog

Planning snapshot: 2026-09-24, based on merged implementation commit `5f0f850` (PR #32). Update this index and the relevant GitHub tracker when a slice merges or its scope changes. Live issue state takes precedence over this dated snapshot. The [roadmap](../ROADMAP.md) retains milestone completion gates.

The original eight open issues (#2-#9) are milestone trackers, not eight unstarted tasks. The 19 focused issues below separate remaining work from merged slices. Issue counts are not a completion percentage. M1-M5 remain incomplete; full workflow conformance, measured effectiveness and independent security review remain pending. Package publication stays disabled.

## Merged progress

| Milestone | Implemented or documented slices | Evidence |
| --- | --- | --- |
| M0: Foundation | Governance, licensing, paired workspaces, shared registry and protected-main CI. | [Repository](../README.md), [governance](../GOVERNANCE.md), [CI](../.github/workflows/ci.yml) |
| M1: Normative profile | Signature profile, deterministic CDL tables and six-level trust/enforcement profile; these do not complete the normative inventory. | [#16](https://github.com/realflowmick/psp-cdl/pull/16), [#17](https://github.com/realflowmick/psp-cdl/pull/17) |
| M2: Portable core | Independent TypeScript/Python codecs, signature/key/time validation and policy evaluation; 511 shared profile checks plus two-way interchange and isolated package consumers. | [#18](https://github.com/realflowmick/psp-cdl/pull/18), [library API](library-api.md) |
| M3: Reference services | Authenticated read-only HTTP/MCP services; portable SQLite state; six opt-in session/node/checkpoint operations. | [#19](https://github.com/realflowmick/psp-cdl/pull/19), [#20](https://github.com/realflowmick/psp-cdl/pull/20), [#21](https://github.com/realflowmick/psp-cdl/pull/21) |
| M4: MCPProxy | Read-only gate, stdio/HTTP mediation, buffered output checks, provenance and approved revision refresh. | [#22](https://github.com/realflowmick/psp-cdl/pull/22), [#23](https://github.com/realflowmick/psp-cdl/pull/23), [#24](https://github.com/realflowmick/psp-cdl/pull/24), [#25](https://github.com/realflowmick/psp-cdl/pull/25) |
| M5: LLMProxy | Mock-provider buffered loop; durable turns/recovery/lockdown; expiration/interval refresh and MCP discovery; completion redirects and scoped continuation. | [#26](https://github.com/realflowmick/psp-cdl/pull/26), [#27](https://github.com/realflowmick/psp-cdl/pull/27), [#28](https://github.com/realflowmick/psp-cdl/pull/28), [#30](https://github.com/realflowmick/psp-cdl/pull/30), [#31](https://github.com/realflowmick/psp-cdl/pull/31), [#32](https://github.com/realflowmick/psp-cdl/pull/32) |
| M6: Evaluation | Scoped mixed-language checks and a draft study protocol. No effectiveness study has run; the five original workflow seed cases remain unimplemented. | [Conformance](../conformance/README.md), [study protocol](../evaluation/PROTOCOL.md) |
| M7: Reviewed release | Release gates and local package-consumer checks exist. No reviewed release or independent security validation is claimed. | [Roadmap](../ROADMAP.md), [maintainers](../MAINTAINERS.md), [library API](library-api.md) |

## Work in review and selected next work

#33 has an [open implementation PR](https://github.com/realflowmick/psp-cdl/pull/53).
#34/#35 now have [source inventory/parser review](../specs/reviews/PSP-CDL-REVIEW-0.1.md)
and [API/editorial draft proposals](../specs/errata/PSP-CDL-EDITORIAL-0.1.md).
Their normative acceptance gates remain open. #36 and #39 are the selected next
implementation tasks; the queue below records the original planned ordering.

The working slices now include [bounded differential fuzzing](differential-fuzzing.md)
and [paired isolated MCP fixtures](../evaluation/FIXTURE-SERVERS.md). The fuzz
corpus retains a discovered malformed-JSON validation-order regression. Fixture
checks compare actual tool effects in all four language combinations, including
a successful bypass control. Merge/review status is distinct from this implementation progress.

**[#33: Opt-in buffered live-provider adapters](https://github.com/realflowmick/psp-cdl/issues/33)** is awaiting review in PR #53. Its offline checks and paired adapter contract are recorded in that PR. A live smoke run requires separate operator opt-in; credentials and authoritative policy/session state remain host-owned.

Streaming remains rejected by this slice. [#44](https://github.com/realflowmick/psp-cdl/issues/44) separately defines streaming release semantics and tests the actual output sink. This clarifies the original LLMProxy issue's stale ordering without weakening the M5 completion gate. Neither an adapter nor a live smoke check is an effectiveness study.

## Remaining work

**Review** identifies prepared slices awaiting checks, merge or normative disposition; requirement-dependent behavior waits for review. **Later** work has its own contract and dependency gates. **Deferred** candidates need explicit scope decisions. **Release** tasks prepare and review artifacts without authorizing publication. A dash means no new issue prerequisite, not that contracts or tests can be skipped.

| Queue | Milestone | Task | Dependency or scope gate |
| --- | --- | --- | --- |
| Review | M5 | [#33 Buffered live-provider adapters](https://github.com/realflowmick/psp-cdl/issues/33) | Existing buffered loop; explicit operator opt-in for live calls |
| Review | M1 | [#34 Normative inventory and parser-contract review](https://github.com/realflowmick/psp-cdl/issues/34) | Preserve RFC baselines and record profile/errata decisions |
| Review | M1 | [#35 Missing API reference and editorial errata](https://github.com/realflowmick/psp-cdl/issues/35) | Normative review process; local API contracts remain drafts |
| Review | M2 | [#36 Differential fuzzing and grammar gaps](https://github.com/realflowmick/psp-cdl/issues/36) | #34 for accepted grammar changes; fuzz infrastructure can start earlier |
| Review | M3 | [#39 Isolated governed/adversarial MCP servers](https://github.com/realflowmick/psp-cdl/issues/39) | Synthetic data, bounded I/O and network isolation |
| Review | M3 | [#37 Session listing, cancellation and retention](https://github.com/realflowmick/psp-cdl/issues/37) | Lifecycle and persistence-policy contract |
| Later | M3 | [#38 Scan, decrypt and process tools](https://github.com/realflowmick/psp-cdl/issues/38) | #35; key custody and plaintext-release contract |
| Later | M3 | [#40 PostgreSQL workflow backend](https://github.com/realflowmick/psp-cdl/issues/40) | Transaction/migration contract; mixed-language failure tests |
| Later | M4 | [#41 Distributed workflow/dispatch coordination](https://github.com/realflowmick/psp-cdl/issues/41) | Cross-worker authority/fencing and recovery contract |
| Later | M4 | [#42 Mutating tools and durable dispatch recovery](https://github.com/realflowmick/psp-cdl/issues/42) | #41; recipient idempotency and outbox contract |
| Later | M4 | [#43 Host-owned OAuth integration](https://github.com/realflowmick/psp-cdl/issues/43) | Pin protocol/flow; keep credentials outside model inputs |
| Later | M5 | [#44 Streaming output release](https://github.com/realflowmick/psp-cdl/issues/44) | Define partial-output policy before implementation |
| Later | M5 | [#45 Completion/refresh/redirect composition](https://github.com/realflowmick/psp-cdl/issues/45) | Supported-mode matrix and atomic handoff contract |
| Later | M5 | [#46 Scoped tools and revocation](https://github.com/realflowmick/psp-cdl/issues/46) | Fresh read-only authority; completed application state stays frozen |
| Deferred | M5 | [#47 Additional refresh/signing integrations](https://github.com/realflowmick/psp-cdl/issues/47) | #34; separate required profile work from optional host products |
| Later | M6 | [#48 Workflow conformance and topology harness](https://github.com/realflowmick/psp-cdl/issues/48) | #34, #39; report unavailable implementation combinations explicitly |
| Later | M6 | [#49 Preregister and run the effectiveness study](https://github.com/realflowmick/psp-cdl/issues/49) | #33, #48; frozen protocol/corpus, budget and independent grading |
| Release | M7 | [#50 Repeatable artifacts and compatibility docs](https://github.com/realflowmick/psp-cdl/issues/50) | Local candidates only; publication stays disabled |
| Release | M7 | [#51 Independent review and release decision](https://github.com/realflowmick/psp-cdl/issues/51) | #34, #48, #49, #50; reviewer appointments and recorded decision |

Each issue supplies acceptance criteria, source references and validation requirements. #47 is a review/disposition task: accepted adaptive/checkpoint triggers, degraded continuation, custom URLs or managed signing work must receive focused implementation issues. A managed signing service is not a prerequisite for using the libraries. PostgreSQL and OAuth are explicit integration tracks; current SQLite and host-supplied resource tokens remain supported within their documented scope.

## Tracker and completion rules

| Milestone | Open tracker | Focused issues |
| --- | --- | --- |
| M1 | [#2](https://github.com/realflowmick/psp-cdl/issues/2) | #34, #35 |
| M2 | [#3 TypeScript](https://github.com/realflowmick/psp-cdl/issues/3), [#4 Python](https://github.com/realflowmick/psp-cdl/issues/4) | #36; independent review also tracked by #51 |
| M3 | [#5](https://github.com/realflowmick/psp-cdl/issues/5) | #37, #38, #39, #40 |
| M4 | [#6](https://github.com/realflowmick/psp-cdl/issues/6) | #41, #42, #43 |
| M5 | [#7](https://github.com/realflowmick/psp-cdl/issues/7) | #33, #44, #45, #46, #47 |
| M6 | [#8](https://github.com/realflowmick/psp-cdl/issues/8) | #48, #49 |
| M7 | [#9](https://github.com/realflowmick/psp-cdl/issues/9) | #50, #51 |

- Keep completed slices linked to merged PRs. Close a focused issue only after its acceptance criteria have evidence; close a milestone tracker only after the roadmap gate is met and remaining requirements have explicit dispositions.
- Shared-contract/component changes require paired implementations and shared vectors, `npm run check`, the Python unittest suite and `scripts/check-parity.py`, plus relevant integration/generator checks.
- Blocked, unsupported, skipped and error results do not become passes. Profile checks and build success do not establish full conformance, production readiness or effectiveness.
- Follow [governance](../GOVERNANCE.md) for normative review and independent release review. Queue labels do not appoint maintainers, assign due dates or assert security validation.
- `.github/bootstrap-issues.json` remains the original provisioning seed. Maintain current scope here and in the linked issues instead of treating seed issue text as current status.

The opt-in [session lifecycle draft](lifecycle.md) adds owner-scoped listing, cancellation and bounded policy-approved payload cleanup in both languages. Checkpoint/operation invalidation, replay tombstones and retained metadata have explicit contracts. This #37 working slice requires review; it does not complete M3 or claim physical erasure.
