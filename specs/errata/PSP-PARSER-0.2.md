# PSP parser, alias and refresh corrections 0.2

Status: **review candidate; not adopted**. Date: 2026-09-25. License: CC0-1.0.
This candidate supplies exact future-edition text for PSP-E007-E009 in #34.
The [review record](../reviews/parser-review-0.2.json) identifies publication,
the comment window, source revision and the separate final decision.

PSP Core 3.2.0 and archived 3.1.1 remain unchanged. The existing Codec 1.0,
Signature 2.0 and opt-in Prompt Refresh 0.1 contracts keep their present status.
This candidate does not adopt the API proposal, complete workflow grammar or
change the behavior of the reference implementations.

## PSP-E007: structural content and bounded codec selection

**Source:** PSP Core 3.2.0 §6.3 Content Format, especially line 622, and §6.4
Nesting, line 626. Closing-delimiter-only text conflicts with nested openers;
arbitrary nesting also lacks a resource-bound contract.

**Proposed replacement for §6.3 and the introductory sentence of §6.4:**

> Content consists of ordered text and structurally nested sections. Consumers
> selecting PSP Codec Profile 1.0 MUST process markup, escapes and resource
> bounds according to that profile. Whitespace and Unicode scalar values in
> text MUST otherwise be preserved. An unescaped opening marker can start a
> nested section; the closing marker is not the only structural sequence.
> Markdown fences, HTML and JSON-looking text provide no parsing exemption.
> Malformed or over-limit input MUST fail explicitly and MUST NOT be repaired
> or truncated into trusted content. Profile selection MUST be explicit;
> legacy text MUST NOT silently acquire Codec 1.0 escape semantics.
>
> PSP sections can nest structurally within the limits of the explicitly
> selected representation profile. Nesting alone does not define a valid
> executable workflow graph or grant authority to a section.

**Compatibility:** Existing Codec 1.0 producers/consumers retain the same tree,
source-preservation rules and bounds. Legacy producers that treated opener
sequences as inert content must migrate through explicit codec selection and
escape literal markers. No automatic rewriting of signed text is authorized.

**Evidence:** [Codec 1.0](../profiles/PSP-CODEC-1.0.md), the exact codec cases in
[evidence-0.1.json](../reviews/evidence-0.1.json) (`nested-application:parse`,
`literal-delimiters:canonical-roundtrip`, `nesting-limit`, `depth-limit`) and the
shared codec/profile adapters. These establish selected-profile behavior only.

## PSP-E008: one matched signature-envelope pair

**Source:** PSP Core 3.2.0 §24 JSON Payload Format, lines 6484 and 6486;
`PSP-3.2.0-L06484-01` / `PSP-3.2.0-L06486-01`. The precedence sentence conflicts
with §17.8.2 and Signature 2.0, which already reject simultaneous aliases.

**Proposed replacement for those two sentences:**

> Implementations using Signature Profile 2.0 MUST accept exactly one matched
> root pair: `signature` and `data`, or `x-signature` and `x-data`. They MUST
> normalize either accepted pair to the same internal representation. They
> MUST reject mixed pairs, simultaneous aliases, duplicate decoded property
> names and additional envelope-root members. Standard-name precedence MUST
> NOT resolve an ambiguous envelope into an accepted signature input.

**Compatibility:** Existing Signature 2.0 behavior and signed bytes are
unchanged. Previously ambiguous legacy envelopes need producer correction and
verification under an explicitly selected profile; a reader must not discard
conflicting fields and claim they were authenticated.

**Evidence:** [Signature 2.0 §2](../profiles/PSP-SIGNATURE-2.0.md), the paired
profile harness and `matched-wire-aliases` in the shared evidence catalog.
Existing duplicate/mixed-alias rejection remains in force pending adoption.

## PSP-E009: compatible refresh and strict expiration

**Source:** PSP Core 3.2.0 §24 Re-fetch, line 6328
(`PSP-3.2.0-L06328-01`), and Prompt Refresh Directives, lines 6354/6356
(`PSP-3.2.0-L06354-01`, `PSP-3.2.0-L06356-01`). These conflict with compatible
version refresh in §21 and the strict expiration rule in §17/Signature 2.0.

**Proposed replacement for the original-version sentence:**

> Re-fetch MUST retain the currently accepted content version unless the
> trusted host explicitly approves a higher compatible version. Implementations
> MUST reject SemVer precedence decrements. Equal-precedence replacements MUST
> preserve normalized SYSTEM text, trust level, priority and refresh directives;
> re-signing, authorized key rotation and session binding may change. Higher
> versions, including major-version changes, require host compatibility approval.
> Every replacement MUST pass fresh signature, scope, authority and time checks.

**Proposed replacement for the two expired/degraded-continuation sentences:**

> If refresh cannot obtain fresh authorized content before expiration,
> protected execution MUST pause or fail closed. An expired signature MUST NOT
> authorize further inference, tool dispatch or output release, including
> completion of the current node. A result pending when its authorizing prompt
> expires MUST be withheld; obtaining a later prompt MUST NOT authorize replay
> of that withheld result. A later invocation requires fresh authorization.

**Compatibility:** The [opt-in refresh contract](../profiles/PSP-PROMPT-REFRESH-0.1.md)
already selects these constraints. This amendment does not adopt all of that
draft's scheduling or persistence semantics, add triggers, revoke completed
external effects or grant distributed execution fencing. Hosts relying on
expired-node continuation must migrate to fresh authorization and cannot
silently fall back to expired instructions.

**Evidence:** [Shared refresh cases](../../conformance/vectors/llm/refresh-0.1.json)
include `rollback`, `same-version-change`, `build-metadata-cannot-hide-change`,
`major-approved`, `major-incompatible`, `refresh-failure-at-expiration`,
`expires-during-provider` and `expires-during-tool`. Existing exact version and
expiration vectors remain applicable; normative acceptance is separate.

## Adoption and migration gate

These are proposed normative corrections, not editorial-only changes. Allow
at least fourteen full calendar days after public availability of this exact
candidate, restarting for substantive amendments. Collect and disposition
comments, then record the lead's reasoned decision and accepted revision.
Any accepted text belongs in a future version with a source/requirement-ID
migration map; no archived file or old requirement status changes here.
