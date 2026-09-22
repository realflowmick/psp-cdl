# Initial implementability review

These findings are open issues, not silent normative changes. References use the actual section headings where internal subsection numbering is inconsistent.

| ID | Finding | Impact / next decision |
| --- | --- | --- |
| PSP-E001 | §17.3 signs content, timestamp, version, trust level and priority; §17.4 verification and §18.3/§21 examples use only three fields | Blocking: define exactly one versioned signed-byte formula and reject downgrades |
| PSP-E002 | §17.3 signed input omits expiration and other security-relevant envelope metadata | Blocking: define authenticated expiration, key/algorithm context, section identity, scope and replay binding; test attribute mutation |
| PSP-E003 | §17.4 accepts `now < expires`, but timestamp pseudocode rejects only `now > expires` | Blocking boundary case: decide equality and grace behavior explicitly |
| PSP-E004 | §17.8 permits JCS or sorted-key serialization; sorting alone does not define number/Unicode serialization | Blocking interoperability: select canonical bytes and fixed cross-language vectors |
| PSP-E005 | Abstract says five trust levels while range 0–5 contains six; attention-isolation language requires inference-engine support | Clarify taxonomy and separate engine-enforced isolation from proxy controls |
| PSP-E006 | RFC-PSP-API is referenced but absent from the supplied documents | Draft service contracts with explicit project status; do not claim an existing normative API |
| CDL-E001 | §7.6.3 describes multiple independent layers and strong violation guarantees | Qualify complete mediation, capability honesty, common-mode failure and output leakage assumptions; validate empirically |
| CDL-E002 | Vocabulary extensions, inheritance, explicit negation and semantic matching need a finite deterministic profile | Enumerate unknown/contradictory terms, trust authority for negation, and complete Appendix B behavior before PDP conformance |
| DOC-E001 | PSP subsection numbers and CDL RBAC §11 subsections contain stale numbering | Editorial correction in next revision; use heading names plus file/version now |

`conformance/requirements.json` links starter requirements to relevant blockers. The first implementation milestone should expand this review to all normative MUST/MUST NOT statements.
