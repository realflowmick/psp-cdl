# CDL interpreter reconciliation

Candidate: [CDL 1.5 interpreter 0.1](../specs/systemprompts/CDL-v1_5-Interpreter-draft-0_1.md).
Tracking: [#77](https://github.com/realflowmick/psp-cdl/issues/77), under #7.
This is the priority-3 instruction artifact, a companion to the
[PSP interpreter candidate](psp-interpreter.md). Neither is installed by the
existing provider loop. Model interpretation, enforcement effectiveness and full
conformance remain untested by these instruction artifacts.

Install through authenticated SYSTEM configuration with the approved application,
data governance, capability/evidence projections and actual operation bindings.
Do not append the old CDL 1.1 prompt's conflicting rules. The candidate keeps
semantic interpretation in context; the finite policy library is a supporting
operation gate, not a replacement for model reasoning or a PSP branch selector.

## Source and requirement accounting

The [review index](reviews/cdl-interpreter-0.1.json) records all **96 CDL entries**
from the existing register, grouped by review topic with instruction anchors,
unchanged statuses/blockers and explicit remaining gaps. Its companion reference
checks those IDs against the 96 deferred in the PSP index, whose 364 PSP entries
complete the **460-entry inventory**. Topic traceability is not clause-complete
semantic coverage. Baseline prose outside uppercase-keyword entries is reviewed
through the topics and scenarios, including derived data and display semantics.

Pins cover the candidate, CDL 1.5, selected profiles, normative policy table,
requirement register and PSP companion review/candidate. Tracked text pins use
UTF-8 with LF endings; the unmodified local CDL_Governance_System_Prompt1_1.md
is recorded by its raw-byte hash and is not added to Git. A clean clone does not
need that historical local input. Published RFCs, policy tables, runtime contracts
and the requirement register are unchanged.

The PSP 0.1 review's deferred-CDL list remains a historical record of priority 2,
not a current claim that CDL reconciliation has no artifact. Its candidate's
pending-CDL note describes that original standalone scope; this explicitly
selected companion supplies the missing instruction slice. Joint installation,
receipt channels and behavior validation still require priority 4.

## Requirement-to-instruction topics

| Topic | Source basis | Candidate | Reconciliation and remaining gap |
| --- | --- | --- | --- |
| semantics | §§3, 7.1–5, 10.3 | C01, C06 | Interpret meaning and alternatives in context; host permission remains separate. No model behavior evidence. |
| syntax | §4, 10.1; profile §2 | C02 | String/array equivalence, ASCII normalization, contradictions and limits. Broader syntax may be valid CDL but outside selected profile. |
| inheritance | §6; profile §3 | C03 | Root-to-leaf propagation, actual field/items paths and all input origins. Unsupported schema applicators remain explicit. |
| negation | §§4.3, 6.4; profile §3 | C04 | Grants must cover every originating contribution at the exact path/revision. Chat approval and signatures alone do not grant removal. |
| capabilities | §5, 10.4, 13.2; profile §4 | C05 | Complete union, transitive effects and directed implications; no response-time subtraction. Discovery/behavior honesty remains external. |
| matching | §7, Appendix B; profile §5 | C06 | Conflicts before assurances, explicit AND/OR/check distinctions; baseline grouping is not universal equivalence. |
| derived | §8.3; profile §3; Trust 1.0 | C07, C15 | Summaries/embeddings/state keep all policies unless an authorized transformation replaces them. No release by masking alone. |
| visibility | §8.3, A.6; profile §5 | C08 | Processing, operator display and subject disclosure differ. Safe projections and enforced transformations need integration. |
| roles | §11 RBAC (stale §12 headings); profile §6 | C09 | Exact authenticated roles, no inferred hierarchy; arbitrary role/permission terms remain unsupported by finite profile. |
| jurisdictions | §8.3, Appendix B; profile §6 | C09 | All processing locations and origins must pass. EU/US-only finite support remains visible. |
| evidence | §8.3; profile §§1, 5 | C10 | Current authorization, installed controls and operation-bound evidence; capabilities are not receipts. |
| legal-basis | §8.3, Appendix B; profile §7 | C10 | Alternatives are local to one declaration occurrence; independent policies/resources remain conjunctive. No legal determination. |
| signatures | §9, 13.1/3; profile §1 | C11 | Original-byte verification before normalization, scoped authority, no untrusted validation URL. Standalone legacy signature format unsupported here. |
| topology | §7.6, 13.4/7; Trust 1.0 | C12 | Complete mediation and minimum topology; no automatic downgrade or independent-layer guarantee. |
| vocabulary | §§8.2/5, 12, Appendix C; profile §2 | C13 | Broad semantic comprehension remains; finite support is explicit. HL7/ODRL/DPV/FHIR adapters are not supplied. |
| reporting | §10.2/3, 13.5; profile §8 | C14 | Actual reason codes, private diagnostics and audit receipts; safe alternatives need fresh evaluation. |
| composition | PSP §§11–16, 22; CDL §10.3 | C07, C15 | Combine affinity, qualified transitions, CDL and state persistence without confusing model state with host authority. Wiring pending. |

## Changes from the local 1.1-compatible prompt

- Replaced “always process internally” and automatic summary release with separate
  pre-inference, processing and release checks. Derived conclusions remain governed.
- Replaced AUTHORIZE-in-chat exceptions with actual custodian/delegate grants;
  every origin must authorize negation. A signed child is insufficient.
- Preserved capability union despite the baseline's contradictory override/priority
  language. Omitting logging in a tool/response declaration cannot erase server
  logging or transitive side effects.
- Removed guessed role hierarchies and unverified session-role assertions. Host
  identity/check results remain authoritative; model-visible projections are data.
- Replaced “valid signature = full trust” with integrity plus authority/scope/freshness
  checks. Signature 2.0 verifies before token normalization; no untrusted URL lookup.
- Corrected hipaa satisfaction from legacy OR to selected-profile AND plus evidence;
  distinguished encryption in transit, at rest and in use. Retained the explicit
  table's no-training/analytics conflict rather than narrowing it by intuition.
- Added 1.3/1.4/1.5-era collection, consent, agreement, jurisdiction, subject-rights,
  AI risk/trustworthiness and interoperability concepts with support limitations.
- Added origin-local legal-basis alternatives and all-resource checking; summaries
  and independent policy origins cannot disappear into flattened sets.
- Replaced automatic “secure link/redacted email” alternatives and invented audit
  success with fresh evaluation and actual receipts. State persistence cannot
  override no-persist, and no-log cannot silently cancel an audit requirement.

## Profile selections and remaining decisions

These are explicit uses of existing profiles or candidate handling rules, not
new normative amendments. CDL-E001/E002 are resolved only for profile adopters.
Open baseline or integration choices remain open; this candidate does not adopt
parser/API proposals or silently extend the finite vocabulary.

| ID | Baseline/legacy tension | Disposition |
| --- | --- | --- |
| D01 | Open semantic vocabulary versus finite matching support | C01/C13 retain model comprehension; unsupported host semantics block the affected operation. Extensions need separate approved rules and evidence. |
| D02 | §6.6 ancestor accumulation can resurrect an intermediate negation | Selected profile §3 evaluates root-to-leaf, retaining removal down its branch until reintroduced; origin-specific grants are mandatory. |
| D03 | §5.8 tool override/discovery priority versus union/no capability negation | Selected profile §4 unions applicable sources. Earlier hazards cannot be subtracted; refreshed snapshots require host acceptance. |
| D04 | Operator-blind examples permit conclusions, but derived policy preservation may still prohibit their display | No automatic summary exception under the selected profile; authorized transformation/replacement plus fresh release checks required. Broader release contracts remain priority 4. |
| D05 | Appendix B grouping/commas do not define all AND/OR/evidence semantics | Existing profile/table decide: audit OR, encryption AND, hipaa AND, directed implications and scoped checks. No new runtime table changes. |
| D06 | no-collect versus Appendix B's transient-processing satisfaction | Profile §5 forbids ingestion; transient handling cannot waive it. no-derived-collection has distinct ephemeral semantics. |
| D07 | Heuristic RBAC/permission/HL7 URI strings versus finite grammar | Preserve requested semantic intent; invalid syntax and unsupported well-formed terms remain distinct. No guessed rewrites or implied adapters. |
| D08 | CDL §9 normalization-before-signature and validation URL examples | Use selected Signature 2.0 over original complete content; trusted registry/host checks before normalization. Legacy example is not an interoperable fallback. |
| D09 | Graceful topology degradation and independence claims in §7.6 | Trust 1.0 requires authenticated minimum topology, operational gates and no downgrade; no unconditional security guarantee. |
| D10 | Broad lawful-basis alternatives versus independent origins | Profile §7 OR is local to one occurrence; each resource/origin remains conjunctive. Special-category/custom bases remain unsupported. |
| D11 | Regulatory/sensitivity labels and external standards are semantic references, not determinations | Preserve domain meaning without claiming law, compliance or universal hierarchy. Jurisdiction-sensitive mappings and certification evidence need approved adapters/policy. |
| D12 | PSP durable state versus CDL no-persist/no-log/retention duties | Host-approved reconstructible projection or explicit blocked workflow; do not drop policy or claim persistence occurred. Actual channel/receipt contract remains priority 4. |

## Review scenarios and validation

[CDL scenarios](reviews/cdl-interpreter-scenarios-0.1.json) cover useful allowed
paths and adverse cases, with explicit setup, stimulus and expected observations.
All are **not-run** model scenarios. They do not measure semantic matching,
confidentiality, attack resistance or provider/tool effects.

`uv run --locked python scripts/check-interpreter-review.py` checks both review
artifacts, source pins, exact ID accounting, instruction anchors and scenario
references. It verifies that the PSP deferred list is exactly covered by the CDL
index and that their disjoint sets cover all 460 entries. Static validation does
not change the underlying requirement status or manufacture model observations.
The same command runs in both Python CI jobs. Existing library and parity tests
remain infrastructure evidence only.

Next: review the two candidates together, define actual model-visible context and
host-private receipt/policy channels, connect state/service outcomes, and run the
scenarios against model transcripts and real effects. Evaluation and release
retain the roadmap's separate gates.
