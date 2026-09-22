# Initial implementability review

PSP-E001 through PSP-E004 are resolved in PSP Core 3.2.0 and signature profile 2.0. PSP-E005, CDL-E001 and CDL-E002 are resolved for adopters of the versioned trust/enforcement and deterministic-policy profiles below. PSP-E006 and DOC-E001 remain open. Archived RFCs are unchanged. References use the actual section headings where internal subsection numbering is inconsistent.

| ID | Finding | Impact / next decision |
| --- | --- | --- |
| PSP-E001 | §17.3 signs content, timestamp, version, trust level and priority; §17.4 verification and §18.3/§21 examples use only three fields | Resolved in 3.2.0: exactly three fields; complete protected section inside canonical content. |
| PSP-E002 | §17.3 signed input omits expiration and other security-relevant envelope metadata | Resolved in 3.2.0: expiration, key/profile/type and section attributes bound inside content; independent authority/scope checks. |
| PSP-E003 | §17.4 accepts `now < expires`, but timestamp pseudocode rejects only `now > expires` | Resolved in 3.2.0: mandatory timestamp/expiration, reject at equality, no post-expiration execution grace. |
| PSP-E004 | §17.8 permits JCS or sorted-key serialization; sorting alone does not define number/Unicode serialization | Resolved in 3.2.0: JCS only, no Unicode normalization, canonical base64url and shared byte/crypto vectors. |
| PSP-E005 | Abstract says five trust levels while range 0–5 contains six; attention-isolation language requires inference-engine support | Resolved by PSP-TRUST-1.0: six provenance/authority levels; proxy controls do not establish attention isolation. |
| PSP-E006 | RFC-PSP-API is referenced but absent from the supplied documents | Draft service contracts with explicit project status; do not claim an existing normative API |
| CDL-E001 | §7.6.3 describes multiple independent layers and strong violation guarantees | Resolved by PSP-TRUST-1.0 and CDL-DETERMINISTIC-1.0: complete mediation, scoped trusted facts, downgrade rejection and conditional guarantees; effectiveness remains unmeasured. |
| CDL-E002 | Vocabulary extensions, inheritance, explicit negation and semantic matching need a finite deterministic profile | Resolved by CDL-DETERMINISTIC-1.0: finite tables, root-to-leaf provenance, scoped negation grants, explicit AND/OR/evidence rules and unsupported-term rejection. |
| DOC-E001 | PSP subsection numbers and CDL RBAC §11 subsections contain stale numbering | Editorial correction in next revision; use heading names plus file/version now |

`conformance/requirements.json` links starter requirements to relevant blockers. The first implementation milestone should expand this review to all normative MUST/MUST NOT statements.

Resolutions: [PSP Signature Profile 2.0](../profiles/PSP-SIGNATURE-2.0.md), [CDL Deterministic Policy Profile 1.0](../profiles/CDL-DETERMINISTIC-1.0.md), [PSP Trust and Enforcement Profile 1.0](../profiles/PSP-TRUST-1.0.md). Requirement implementation status remains unimplemented until production code passes the relevant conformance cases. These resolutions do not assert support for every term in the larger CDL vocabulary.
