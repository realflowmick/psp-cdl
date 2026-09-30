# PSP interpreter reconciliation

Candidate: [Core 3.2.0 interpreter 0.1](../specs/systemprompts/PSP-Core-v3_2_0-Interpreter-draft-0_1.md).
Tracking: [#72](https://github.com/realflowmick/psp-cdl/issues/72), under #7.
This is the priority-2 instruction artifact, delivered in #73 with #72 closed.
The opt-in [context/service integration](context-service.md) can install it with
host approval. It is not an adopted normative profile or evidence of successful model execution.
The [CDL companion reconciliation](cdl-interpreter.md) now supplies priority 3;
initial context/service wiring is merged in #80. The [joint validation harness](joint-interpreter-validation.md)
supports the next behavioral review; actual model validation remains pending.

The candidate is standalone: install it as authenticated SYSTEM text alongside
the approved application, relevant context and explicit host capabilities. Do not
concatenate it with the older prompt's conflicting instructions. A user-pasted
copy does not establish a trusted runtime. Hosts must select Signature 2.0 and
Trust 1.0 explicitly and provide actual verification/operation results.

## Source and requirement accounting

The [review index](reviews/psp-interpreter-0.1.json) pins the RFC, profiles,
requirement register and candidate by SHA-256, records hashes of the seven local
legacy files inspected, and indexes all **364 PSP requirements** from the
460-entry register. The other **96 CDL requirements** were deferred to priority 3
in this historical index and are now indexed by the [CDL companion](cdl-interpreter.md).
The original register and its pending/blocked statuses are unchanged.
Local legacy files are retained unchanged and are not added to Git by this slice.
Their hashes identify the reviewed local inputs without requiring their presence
in another checkout.
Tracked text pins use UTF-8 with LF line endings so Windows checkout conventions
do not change review identity; historical local input pins use exact raw bytes.

Each index row points to a review topic with candidate sections and a remaining
gap. This is topic-level traceability, not a claim that every clause is fully
implemented. Repeated summary clauses and glossary requirements are retained by
their original IDs. Sections 4, 15 and other behavioral prose also matter even
when they have no uppercase-keyword entry; the topic table and scenarios include
them explicitly. Rows preserve existing blockedBy and status values.

| Topic | RFC basis | Candidate | Reconciliation and remaining gap |
| --- | --- | --- | --- |
| ownership | §§4–5, 16 | P01, P04 | LLM owns branching and state interpretation. Host validation/persistence does not choose conditions. Initial wiring merged in #80; actual model validation pending. |
| syntax | §§6–7, 9.2, 13 | P02 | Preserve structure, scope and text; malformed input cannot grant trust. Parser errata PSP-E007 remain under review. |
| trust | §§12.2–4, 17.7; Trust 1.0 | P03 | Six levels; provenance cannot be self-asserted. Engine isolation unsupported by a prompt. |
| signatures | §§13.3, 17.1–8, 18 | P03, P11 | Replace visual/legacy verification with host Signature 2.0 results, nested checks and strict expiry. Algorithm and key support is external. |
| turns | §§9.4, 10, 16 | P04, P05 | Multi-turn completion, composite and loop records, conditional reset/session behavior. Model behavior untested. |
| affinity | §11 | P06, P08 | Ordinary hierarchy union differs from nested-application restrictions; no inheritance from sequential nodes. Supported dispatch bindings pending. |
| transitions | §§12.5–10, 15 | P07 | Preserve natural-language reasoning, qualification defaults/presets and computed-field provenance. Priority ambiguity requires disposition; no external selector. |
| nested | §8.6 | P08 | Independent sessions/output and stricter parent security; do not inline child state. Nested application service composition pending. |
| output | §14 | P09 | Hierarchical records, variable promotion/merge, partial state and channel separation. Fixed legacy emission order is a local convention. |
| persistence | §§5.4, 14.3.9, 22 | P01, P04, P09, P13 | #80 adds running-state persistence and receipts. Completion composition and atomic remote effects remain pending. |
| checkpoint | §§10.1.5, 21.18, 22 checkpoint operations, 27.7 | P10, P11 | Actual receipts, private token handoff and authenticated resume. A chat approval cannot substitute for host authorization. |
| refresh | §21 | P11 | All declared trigger meanings, counter rules, reconciliation and failure handling. Additional trigger/degraded modes unsupported in existing adapters; PSP-E009 pending. |
| threat | §28 | P12 | Raw context-blind assessment separated from host enforcement; turn-based decay. No measured threat classification or suppression effectiveness. |
| errors | §§16.4, 23 | P13 | Unified escape and explicit failures, no fabricated rollback or unsafe replay. Remote effect recovery requires its own contract. |
| completion | §8.5, §28.12 | P14 | Default unmanaged, host lockdown, scoped SYSTEM and independent redirect. Existing mode-composition limits remain. |
| portability | §14.3.10, §22.4 | P15 | State plus parent chain/current/target definitions; no state-only reconstruction claim. Cross-model interpreter behavior untested. |
| encryption | §17.9 | P16 | Service-owned keys/decryption, timing and zones; unencrypted bootstrap. Existing unsupported encryption forms remain unsupported. |
| libraries | §§19–20 | P16 | Settings versus outputs, sealed/extracted hierarchy, pins and host-validated edits. Library services remain outside this slice. |
| modes | §8.3, §27.4 | P12, P17 | Authenticated mode selection; never user-requested downgrade. Debug/demo semantics need explicit host support. |
| confidentiality | §§8.5.4, 27.4 | P12, P14 | Separate state/assessment from user output; protect SYSTEM even at low threat scores. Instructions do not prove non-disclosure. |
| api | §22 service forms; missing API reference | P06, P10, P17 | Tool names in examples are not automatically callable bindings. API adoption #35/#38 pending. |

## Changes from the local legacy prompts

The principal input was PSP-Core-v3_1_2-SystemPrompt.md; its minified variant,
two lite preambles, adherence stances, form-node prompt and CDL governance prompt
were inspected as companion material. Their labels do not identify a published
Core 3.1.2 RFC in this repository. No minified candidate is generated until the
standalone candidate is reviewed; parallel hand-maintained copies risk drift.

- Removed the assertion that loading a prompt makes the model PSP-compliant.
- Replaced the old signature attribute checklist with Signature 2.0 and explicit
  host verification. A signature-looking string is not a verification receipt.
- Kept full workflow state model-visible, but separated it from host authority
  and user-visible output. Do not print private resume credentials in state.
- Removed unconditional public state emission and contradictory duplicated
  node_completed marker rules. They are not Core requirements. A host can select
  a documented private output convention during priority 4.
- Corrected the lite premise that pasting a workflow grants SYSTEM trust and that
  chat approval authenticates resume; no lite replacement is included here.
- Added parent-scope transitions, full source qualification, nested-application
  restrictions, composite/loop records, variable merge/promotion and recovery
  definitions omitted or compressed in the old prompt.
- Corrected reset's unconditional new-session/threat-reset wording: configuration
  controls session generation and preservation; host authority is never copied.
- Retained multi-turn reasoning and all condition forms; no executable grammar.
- Distinguished raw model threat assessment from authoritative security policy.
  Removed unconditional assessment when threat-assessment is disabled and invented
  threshold defaults. Rationale is a concise decision summary, not private reasoning.
- Retained strict expiry instead of completing a node using expired instructions.
  Refresh/degraded conflicts remain documented rather than silently adopting errata.
- Explained that a portable snapshot needs interpreter and relevant definitions,
  and that emitted signatures, links and effect claims require actual services.

## Open interpretation and integration decisions

These are candidate handling rules, not amendments to published normative text.
An application depending on an unresolved choice must supply an approved,
unambiguous contract or report blocked/unsupported behavior.

| ID | Source tension or missing contract | Candidate treatment / next disposition |
| --- | --- | --- |
| R01 | §15.2/15.4 allow priority but do not define direction, ties or the meaning of omitted condition | Preserve appearance order when no priority applies. Do not invent ordering/default truth when it affects routing; require application clarification or reviewed profile. |
| R02 | §24 parent-scope transitions versus node-local examples in §§9/10 | Follow parent-scope/sibling rule; retain literal examples as historical illustrations. Do not silently normalize ambiguous application structure. Parser review remains required. |
| R03 | §12.10 calls endpoint union restrictive, while §8.6 forbids weaker child applications | Retain the explicit union rule for ordinary nodes and narrower child-application boundary; request host-validated effective configuration rather than modifying signed text. |
| R04 | PSP-E009: original-version re-fetch, newer refresh and degraded execution versus strict expiry | Original-version re-fetch; explicitly approved monotonic refresh; no expired execution. Existing proposed erratum is not adopted here. |
| R05 | §14.3.2 workflow status enum omits degraded used by §21.15 | No fabricated enum extension. Report unsupported degraded mode or use a separately agreed adapter contract. |
| R06 | §28.11.2 says minimal has one-line rationale; §28.11.3 definitions/examples omit it; none example drops flags | Candidate follows field definition: flags retained, rationale omitted at minimal/none. Record for normative review; no new schema adoption. |
| R07 | §8.3 dev/debug validation skips versus strict production/profile rejection | Explicit host-selected experiment only; never a user-controlled downgrade or verified-production claim. Host may reject unsupported modes. |
| R08 | §24 confidentiality parenthetical uses zone/trust numbering inconsistently | Distinguish section/decryption zones from six provenance levels. Apply disclosure rule to USER-zone recipients and host release policy; never equate session level 2 with user provenance. |
| R09 | Legacy full-state emission, fixed marker order and extra status fields have no Core wire contract | Preserve semantic state requirements; defer actual channel/schema/lifecycle integration to priority 4. Do not advertise old conventions as normative. |
| R10 | §5.4 atomic execution cannot be established by a model or an ordinary state write for remote effects | Distinguish receipt-confirmed state and unknown effects. Mutating recovery/idempotency remains #41/#42 work. |
| R11 | RFC checkpoint output includes resume_token, but credentials must remain host-private | #80 supplies a model-visible projection and host-private token handoff with authenticated resume; original wire/schema adoption remains separate. |
| R12 | Adherence stances/form-node companion instructions add semantics beyond this Core slice | Do not silently import them as Core requirements. Separate extension reconciliation if selected. CDL instructions now have a separate [priority-3 candidate](cdl-interpreter.md). |

## Review scenarios and validation

[Review scenarios](reviews/psp-interpreter-scenarios-0.1.json) specify concrete
inputs, candidate anchors and expected observable behavior, including useful
success paths and failure cases. They are **not executed model results**. They
must later be exercised against the installed candidate with actual transcripts,
tool effects/receipts and host denials. Scripted answers cannot discharge them.

Run `uv run --locked python scripts/check-interpreter-review.py` to check source
pins, exact PSP/CDL ID accounting, topic/anchor links and scenario references.
This static check deliberately leaves every model scenario `not-run` and every
whole-clause status unchanged. It does not score prompt semantics or run a model.
Existing library, Python and parity checks remain infrastructure regression checks.

Before promoting the candidate: review R01–R12 and the CDL companion; define the actual
model-visible context/state and private host channels; exercise the scenarios
with model outputs and real service outcomes; map evidence back to obligations.
Effectiveness evaluation and publication retain their separate gates.
