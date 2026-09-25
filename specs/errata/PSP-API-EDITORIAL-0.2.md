# API adoption and editorial disposition 0.2

Status: **public review; not adopted**. Date: 2026-09-25.
License: CC0-1.0. This proposal advances #35 and supersedes only the proposed
PSP-E006 option in [editorial draft 0.1](PSP-CDL-EDITORIAL-0.1.md). That earlier
proposal remains an accurate historical record, not an accepted decision.

## PSP-E006: proposed new normative API

The selected proposal is the new [API 1.0.0 candidate](../api/RFC-PSP-API-v1_0_0-candidate.md).
The alternative in 0.1, deleting the absent API reference without defining an
API, is not selected for this review. Neither alternative is accepted yet.

After adoption, a **future Core revision** would replace the Scope bullet with:

> Network protocol and API wire contracts are specified separately in
> RFC-PSP-API 1.0.0. Implementations must explicitly declare that API selection
> and its supported transport and optional extensions.

The final reference is contingent on adoption/publication of that version.
PSP 3.2.0 and archived 3.1.1 still refer to an API that was not supplied with
those revisions. No historical implementation gains conformance by this edit.
API section 7 records substantive compatibility decisions separately from the
editorial numbering changes below, including private checkpoint credentials and
differences from the security examples. Adoption must address those decisions
explicitly; it cannot be inferred from matching eleven tool names.

## DOC-E001: exact future-edition corrections

The [contract index](../api/contract-set-1.0.0.json) carries all eleven exact
source lines, original headings, proposed headings and source/proposed anchors.
It is generated from the frozen 0.1 review map, not a global number replacement.

| Source | Existing heading prefix | Future heading prefix |
| --- | --- | --- |
| PSP Core 3.2.0, Checkpoint Operations | 21.5.4 | 22.5.4 |
| PSP Core 3.2.0, Security Operations | 21.5.5 | 22.5.5 |
| CDL 1.5, RBAC children only | 12.2–12.10 | 11.2–11.10 |

These edits change numbering only. A future edition must retain aliases for
old anchors and use version plus heading name in ambiguous cross-references.
The proposed anchors are a migration map, not links to an already published
new edition. CDL's actual section 12 remains untouched. Referencing an old
version continues to resolve to its original heading. No correction is applied
to an archived RFC in this PR.

## Review and disposition

The [adoption record](../api/adoption-1.0.0.json) keeps the API/reference choice,
numbering corrections, compatibility decisions, deferred parser errata and final
adoption gate distinct. Existing resolved errata and requirement IDs are not
renumbered. Acceptance requires the public comment window and recorded decision
in [GOVERNANCE](../../GOVERNANCE.md); the solo-maintainer implementation-merge
exception does not waive that normative comment period. Independent review is
not asserted. A later decision must record objections and the reasoned outcome.
