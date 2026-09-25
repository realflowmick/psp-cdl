# PSP/CDL requirements and parser review 0.1

Status: **draft review record**, 2026-09-24. CC0-1.0. Targets PSP Core 3.2.0
and CDL 1.5 only. No baseline text, profile selection or normative decision changes.
Related issues: #34, #35 and #36.

## Inventory method and limits

[The register](../../conformance/requirements.json) includes all 443 uppercase
RFC 2119/8174 keyword occurrences in the two frozen source files, including
242 MUST/MUST NOT occurrences. Every occurrence has a version, exact line,
column, heading path and quotation. SHA-256 binds the source bytes. IDs use
version/line/ordinal and remain stable for these immutable baselines; a future
revision gets a separate register and an explicit migration map.

All uppercase MUST, MUST NOT, SHALL, SHALL NOT, SHOULD, SHOULD NOT, REQUIRED,
RECOMMENDED, NOT RECOMMENDED, MAY and OPTIONAL are audited. Fenced examples and
the keyword-definition sentence are retained in the audit with explicit
dispositions. Other prose, tables, appendices, definitions and abstract usages
are conservatively retained as obligation candidates, even when descriptive.
A lead-in requirement applies to its following list/table; `contextEndLine`
includes that material up to the next heading or paragraph-group boundary.
One keyword can govern several sub-obligations; this is an occurrence-complete
register, not a claim that a lexer can adjudicate every normative clause.
Lowercase keywords, examples and non-keyword prose cannot independently create
an automatic pass. Archived PSP 3.1.1 is provenance, not the current target;
profiles and service drafts are separately selected contracts, not extra RFC
requirements silently added to this denominator.

The 31 legacy IDs remain intact for compatibility, including the references
used by the five unexecuted workflow seed vectors. New entries record a
provisional component/enforcement boundary and applicable profile family.
Each is explicitly blocked or unimplemented at the **whole-obligation** level.
Related executable evidence is intentionally partial; it is not an assertion
that every clause under that heading passes. `scripts/check-requirements.py`
executes both actual library adapters and requires every linked evidence ID to
pass. Mere fixture existence and generated inventory checks do not discharge
requirements. Clause splitting and evidence adjudication remain maintainer
review work; unsupported engine isolation, broad semantic matching, encryption
and missing APIs are not promoted to conformance.

Reproduce: `python scripts/generate-requirements.py --check`, then after building,
`python scripts/check-requirements.py`. The full workflow harness still exits 2.

## Parser and policy disposition

| Subject | Current selected contract and executable evidence | Review disposition |
| --- | --- | --- |
| Markup delimiters, nesting, escaping | PSP-CODEC-1.0; nested-application, literal-delimiters, fences-are-not-parser-exceptions | PSP §6.3 closing-delimiter-only prose conflicts with structural nesting/escaping. PSP-E007 draft; do not infer Markdown fence immunity. |
| Type/attribute grammar | Lowercase section types; ASCII attribute names; immediate equals; JSON double quotes or restricted bare values; duplicates rejected | Preserve codec grammar. Unknown syntactically valid extensions parse but gain no authority; service critical-attribute allowlists are separate. |
| Workflow semantics | Codec transports nested sections | Node graphs, mandatory workflow fields and complete workflow execution are unimplemented, not implied by a successful parse. |
| Canonicalization | JCS, duplicate decoded-key rejection, finite binary64 and safe integer limits, no Unicode normalization | Preserve Signature 2.0/Codec 1.0; transport source hints are untrusted and reparsed. |
| Resource limits | 4 MiB representation, 64 nested sections, 256 JSON depth and bounded nodes/attributes | Preserve explicit bounded profile. Baseline arbitrary-nesting language does not authorize unbounded allocation. |
| Signature aliases | Exactly one matched standard or x-alias pair; mixed/duplicate pairs rejected | PSP §24 says standard fields take precedence; PSP-E008 proposes reference correction to strict Signature 2.0. |
| Vocabulary and semantic matching | Finite CDL table, explicit directed implications, unknown/HL7/custom terms unsupported | CDL-E002 resolved only for profile adopters; broader RFC/appendix semantic obligations remain unimplemented. |
| Inheritance and negation | Root-to-leaf origin records; exact path/policy host grants; every origin must authorize removal | Preserve deterministic profile; declaration text cannot self-authorize a removal. Unsupported traversed schema constructs fail explicitly. |
| Capabilities and trust | Host-owned complete capability union; signer authorization independent of valid bytes | No remote annotation or model statement supplies authority. Proxy controls do not implement attention isolation. |
| Refresh version/expiry | Host compatibility approval and no rollback; no execution after expiry | PSP §24 original-version/degraded-expiry prose conflicts with §§17/21 and selected profiles. PSP-E009 draft; fail-closed behavior remains. |

The [evidence catalog](evidence-0.1.json) names implementation files and exact
executed cases. Differential fuzzing may add tests for these selected profile
rules; it must not adopt the draft errata by changing grammar.

## Decisions and public review

Existing profile selections are recorded in [the errata register](../errata/README.md).
This review accepts **no new normative decisions**. Proposed PSP-E007/E008/E009,
PSP-E006 resolution and DOC-E001 corrections are draft; outstanding review is
explicitly blocked. See [the versioned API/editorial proposal](../errata/PSP-CDL-EDITORIAL-0.1.md).

Under [GOVERNANCE](../../GOVERNANCE.md) and [PROCESS](../PROCESS.md), normative
adoption requires at least 14 calendar days of public comment and a recorded
maintainer disposition. The PR publishes review material; the maintainer must
record the review start/end, comments, dispositions, accepted revision and
compatibility decision before adoption. The later [Parser 0.2 candidate](../errata/PSP-PARSER-0.2.md)
and [review record](parser-review-0.2.json) advance PSP-E007-E009 with exact
future-edition wording and a separate comment window. #35 uses the
[API adoption record](../api/adoption-1.0.0.json). The
[2026-09-25 acceptance reconciliation](../../docs/reviews/2026-09-25-acceptance.md)
records the completed inventory/evidence audit and remaining normative decisions.
No independent reviewer or completed public-comment window is claimed, and
#34/#35 must remain open until their respective review gates are satisfied.
