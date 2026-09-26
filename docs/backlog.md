# Progress and actionable backlog

Planning snapshot: 2026-09-25, based on merged main commit `79f0cb5` (PR #57, including #58) and the [acceptance reconciliation](reviews/2026-09-25-acceptance.md). PRs #53-#58 are merged; #33, #37 and #39 are closed. Update this index and the relevant GitHub tracker when a slice merges or its scope changes. Live issue state takes precedence over this dated snapshot. The [roadmap](../ROADMAP.md) retains milestone completion gates.

The original eight open issues (#2-#9) are milestone trackers, not eight unstarted tasks. Of the 19 focused issues (#33-#51), 16 remain open; several already have merged implementation evidence and need normative disposition. Issue counts are not a completion percentage. M1-M5 remain incomplete; full workflow conformance, measured effectiveness and independent security review remain pending. Package publication stays disabled.

## Merged progress

| Milestone | Implemented or documented slices | Evidence |
| --- | --- | --- |
| M0: Foundation | Governance, licensing, paired workspaces, shared registry and protected-main CI. | [Repository](../README.md), [governance](../GOVERNANCE.md), [CI](../.github/workflows/ci.yml) |
| M1: Normative profile | Signature, deterministic CDL and trust profiles; expanded requirement inventory, parser/editorial proposals and API 1.0.0 review candidate. Normative decisions remain pending. | [#16](https://github.com/realflowmick/psp-cdl/pull/16), [#17](https://github.com/realflowmick/psp-cdl/pull/17), [#54](https://github.com/realflowmick/psp-cdl/pull/54), [#58](https://github.com/realflowmick/psp-cdl/pull/58) |
| M2: Portable core | Independent TypeScript/Python codecs, signature/key/time validation and policy evaluation; 511 shared profile checks, two-way interchange, isolated package consumers and bounded differential fuzzing. | [#18](https://github.com/realflowmick/psp-cdl/pull/18), [#55](https://github.com/realflowmick/psp-cdl/pull/55), [library API](library-api.md) |
| M3: Reference services | Authenticated HTTP/MCP services; SQLite state and workflow operations; opt-in lifecycle and scan/decrypt/process drafts; isolated governed/adversarial fixtures. | [#19](https://github.com/realflowmick/psp-cdl/pull/19), [#20](https://github.com/realflowmick/psp-cdl/pull/20), [#21](https://github.com/realflowmick/psp-cdl/pull/21), [#56](https://github.com/realflowmick/psp-cdl/pull/56), [#57](https://github.com/realflowmick/psp-cdl/pull/57) |
| M4: MCPProxy | Read-only gate, stdio/HTTP mediation, buffered output checks, provenance and approved revision refresh. | [#22](https://github.com/realflowmick/psp-cdl/pull/22), [#23](https://github.com/realflowmick/psp-cdl/pull/23), [#24](https://github.com/realflowmick/psp-cdl/pull/24), [#25](https://github.com/realflowmick/psp-cdl/pull/25) |
| M5: LLMProxy | Buffered loop and opt-in OpenAI provider adapters; durable turns/recovery/lockdown; expiration/interval refresh and MCP discovery; completion redirects and scoped continuation. | [#26](https://github.com/realflowmick/psp-cdl/pull/26), [#27](https://github.com/realflowmick/psp-cdl/pull/27), [#28](https://github.com/realflowmick/psp-cdl/pull/28), [#30](https://github.com/realflowmick/psp-cdl/pull/30), [#31](https://github.com/realflowmick/psp-cdl/pull/31), [#32](https://github.com/realflowmick/psp-cdl/pull/32), [#53](https://github.com/realflowmick/psp-cdl/pull/53) |
| M6: Evaluation | Scoped mixed-language checks and a draft study protocol. No effectiveness study has run; the five original workflow seed cases remain unimplemented. | [Conformance](../conformance/README.md), [study protocol](../evaluation/PROTOCOL.md) |
| M7: Reviewed release | Release gates and local package-consumer checks exist. No reviewed release or independent security validation is claimed. | [Roadmap](../ROADMAP.md), [maintainers](../MAINTAINERS.md), [library API](library-api.md) |

## Merged slices and selected next work

The implementation/review stack is applied to `main`: buffered provider adapters
(#53), requirement inventory and proposals (#54), differential fuzzing (#55),
isolated fixtures (#56), lifecycle/security tools (#57), and API adoption review
artifacts (#58, included through #57). None of these PRs is awaiting merge.

**[#33: Opt-in buffered live-provider adapters](https://github.com/realflowmick/psp-cdl/issues/33)** is closed. Its offline checks and paired adapter contract are recorded in [PR #53](https://github.com/realflowmick/psp-cdl/pull/53). A live smoke run still requires separate operator opt-in; credentials and authoritative policy/session state remain host-owned. Streaming remains unsupported pending [#44](https://github.com/realflowmick/psp-cdl/issues/44). Neither an adapter nor a live smoke check is an effectiveness study.

The merged [bounded differential fuzzing](differential-fuzzing.md) retains a
malformed-JSON validation-order regression. The [isolated MCP fixtures](../evaluation/FIXTURE-SERVERS.md)
compare observed tool effects in all four language combinations, including a
successful bypass control. #36 still depends on #34 for accepted grammar changes.

The #37/#39 acceptance checklists are reconciled and both issues are closed,
with fresh lifecycle/fixture integration results and explicit limits recorded in
the [acceptance review](reviews/2026-09-25-acceptance.md). #34's inventory and parser
audit preparation is complete; [Parser 0.2](../specs/errata/PSP-PARSER-0.2.md) and
its [review record](../specs/reviews/parser-review-0.2.json) track the proposed
PSP-E007-E009 corrections and final normative gate. #38 has merged draft implementations but retains
its #35 normative dependency. The [API 1.0.0 candidate](api-adoption.md) remains
in public review: its [adoption record](../specs/api/adoption-1.0.0.json) sets the
earliest adoption at **2026-10-09T13:00:31Z** and also requires comment dispositions
and a recorded lead decision. Substantive amendments restart the comment window. Merging #58 does
not adopt the candidate.

The next conformance implementation target is [#48](https://github.com/realflowmick/psp-cdl/issues/48),
building on the accepted #39 fixtures after the relevant #34 normative dispositions.
It must retain explicit blocked/unsupported results for unresolved requirements.

## Remaining work

**Review** identifies outstanding normative dispositions. **Coverage** extends merged infrastructure after its normative prerequisites. **Next** identifies the selected conformance target, subject to its dependencies. **Later** work has its own contract and dependency gates. **Deferred** candidates need explicit scope decisions. **Release** tasks prepare and review artifacts without authorizing publication.

| Queue | Milestone | Task | Dependency or scope gate |
| --- | --- | --- | --- |
| Review | M1 | [#34 Normative inventory and parser-contract review](https://github.com/realflowmick/psp-cdl/issues/34) | First three acceptance criteria evidenced; [Parser 0.2 review](../specs/reviews/parser-review-0.2.json) and recorded normative decision remain |
| Review | M1 | [#35 Missing API reference and editorial errata](https://github.com/realflowmick/psp-cdl/issues/35) | First three acceptance criteria evidenced; API comment window and recorded adoption decision remain pending |
| Coverage | M2 | [#36 Differential fuzzing and grammar gaps](https://github.com/realflowmick/psp-cdl/issues/36) | #55 infrastructure merged; #34 gates accepted grammar changes |
| Review | M3 | [#38 Scan, decrypt and process tools](https://github.com/realflowmick/psp-cdl/issues/38) | #57 draft implementation merged; #35 normative adoption and unsupported-form dispositions remain |
| Later | M3 | [#40 PostgreSQL workflow backend](https://github.com/realflowmick/psp-cdl/issues/40) | Transaction/migration contract; mixed-language failure tests |
| Later | M4 | [#41 Distributed workflow/dispatch coordination](https://github.com/realflowmick/psp-cdl/issues/41) | Cross-worker authority/fencing and recovery contract |
| Later | M4 | [#42 Mutating tools and durable dispatch recovery](https://github.com/realflowmick/psp-cdl/issues/42) | #41; recipient idempotency and outbox contract |
| Later | M4 | [#43 Host-owned OAuth integration](https://github.com/realflowmick/psp-cdl/issues/43) | Pin protocol/flow; keep credentials outside model inputs |
| Later | M5 | [#44 Streaming output release](https://github.com/realflowmick/psp-cdl/issues/44) | Define partial-output policy before implementation |
| Later | M5 | [#45 Completion/refresh/redirect composition](https://github.com/realflowmick/psp-cdl/issues/45) | Supported-mode matrix and atomic handoff contract |
| Later | M5 | [#46 Scoped tools and revocation](https://github.com/realflowmick/psp-cdl/issues/46) | Fresh read-only authority; completed application state stays frozen |
| Deferred | M5 | [#47 Additional refresh/signing integrations](https://github.com/realflowmick/psp-cdl/issues/47) | #34; separate required profile work from optional host products |
| Next | M6 | [#48 Workflow conformance and topology harness](https://github.com/realflowmick/psp-cdl/issues/48) | #39 accepted/closed; #34 disposition remains; unavailable combinations stay explicit |
| Later | M6 | [#49 Preregister and run the effectiveness study](https://github.com/realflowmick/psp-cdl/issues/49) | #33 complete; #48, frozen protocol/corpus, operator opt-in, budget and independent grading remain |
| Release | M7 | [#50 Repeatable artifacts and compatibility docs](https://github.com/realflowmick/psp-cdl/issues/50) | Local candidates only; publication stays disabled |
| Release | M7 | [#51 Independent review and release decision](https://github.com/realflowmick/psp-cdl/issues/51) | #34, #48, #49, #50; reviewer appointments and recorded decision |

Each issue supplies acceptance criteria, source references and validation requirements. #47 is a review/disposition task: accepted adaptive/checkpoint triggers, degraded continuation, custom URLs or managed signing work must receive focused implementation issues. A managed signing service is not a prerequisite for using the libraries. PostgreSQL and OAuth are explicit integration tracks; current SQLite and host-supplied resource tokens remain supported within their documented scope.

## Tracker and completion rules

| Milestone | Open tracker | Focused issues |
| --- | --- | --- |
| M1 | [#2](https://github.com/realflowmick/psp-cdl/issues/2) | #34, #35 |
| M2 | [#3 TypeScript](https://github.com/realflowmick/psp-cdl/issues/3), [#4 Python](https://github.com/realflowmick/psp-cdl/issues/4) | #36; independent review also tracked by #51 |
| M3 | [#5](https://github.com/realflowmick/psp-cdl/issues/5) | #38, #40; #37 and #39 closed |
| M4 | [#6](https://github.com/realflowmick/psp-cdl/issues/6) | #41, #42, #43 |
| M5 | [#7](https://github.com/realflowmick/psp-cdl/issues/7) | #44, #45, #46, #47; #33 closed |
| M6 | [#8](https://github.com/realflowmick/psp-cdl/issues/8) | #48, #49 |
| M7 | [#9](https://github.com/realflowmick/psp-cdl/issues/9) | #50, #51 |

- Keep completed slices linked to merged PRs. Close a focused issue only after its acceptance criteria have evidence; close a milestone tracker only after the roadmap gate is met and remaining requirements have explicit dispositions.
- Shared-contract/component changes require paired implementations and shared vectors, `npm run check`, the Python unittest suite and `scripts/check-parity.py`, plus relevant integration/generator checks.
- Blocked, unsupported, skipped and error results do not become passes. Profile checks and build success do not establish full conformance, production readiness or effectiveness.
- Follow [governance](../GOVERNANCE.md) for normative review and independent release review. Queue labels do not appoint maintainers, assign due dates or assert security validation.
- `.github/bootstrap-issues.json` remains the original provisioning seed. Maintain current scope here and in the linked issues instead of treating seed issue text as current status.

The merged opt-in [session lifecycle draft](lifecycle.md) adds owner-scoped listing, cancellation and bounded policy-approved payload cleanup in both languages. Checkpoint/operation invalidation, replay tombstones and retained metadata have explicit contracts. #37 is accepted and closed for this scoped implementation; it does not complete M3 or claim physical erasure.

The merged opt-in [security tools draft](security-tools.md) adds authenticated scan/decrypt/process in both languages, host-owned AES-GCM key/zone grants and buffered CDL plaintext release. Its 62 shared cases and real two-way HTTP/stdio checks cover all eleven required tool names as draft counterparts. #35 normative API adoption and unsupported encryption forms remain open; this does not complete M3.
