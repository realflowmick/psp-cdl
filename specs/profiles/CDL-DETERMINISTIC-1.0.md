# CDL Deterministic Policy Profile 1.0

Status: Proposed Standard, author-directed implementation profile, September 22, 2026.

Profile identifier: `CDL-DETERMINISTIC-1.0`. Base document: [CDL 1.5](../cdl/RFC-CDL-v1_5.md). Companion: [PSP Trust and Enforcement Profile 1.0](PSP-TRUST-1.0.md). This versioned document resolves CDL-E001 and CDL-E002 for implementations that explicitly select it. CDL 1.5 remains an unchanged archival baseline. This profile takes precedence over the base document on the subjects below; it does not assert support for every CDL extension or legal framework.

The words MUST, MUST NOT, SHOULD and MAY express this project's normative requirements. The [policy table](../../conformance/policy/cdl-1.0.json) is normative machine-readable data. The [decision vectors](../../conformance/vectors/policy/profile-1.0.json) contain expected results for future adapters, not observations of a working policy engine.

## 1. Decision boundary and authority

CDL describes requirements, not permission to execute. `allow` means only that this CDL gate has no remaining objection to one bound operation. Authentication, PSP node/tool affinity, tenant isolation, and other application authorization MUST also allow the operation. `deny`, `unsupported`, parser errors, timeouts and missing evidence MUST prevent dispatch and output release. A model's interpretation, an operator's chat approval, or a tool's self-description MUST NOT override a denial.

Before evaluating data, the host MUST obtain trusted declaration provenance and a complete capability inventory for the selected tool, provider, transit services, logging, storage and reachable callees. Absence of a capability is usable only within an inventory accepted as complete by the configured authority. Unknown or unavailable discovery is not an empty inventory. A signature authenticates a statement; it does not prove that the statement is truthful or that the signer is authorized.

All accepted declarations, negation grants, parameters, capability snapshots and check outcomes MUST be bound to the same tenant, authenticated principal, session, active node, policy revision, data/schema digests, tool identity and revision, invocation arguments and relevant recipient/purpose. These facts come from authenticated infrastructure. They MUST NOT be constructed from model text. Bind the decision to this snapshot and re-evaluate if any bound value changes before dispatch or release. An `allow` decision is not a reusable bearer token.

For portable signed bundles, use [PSP Signature Profile 2.0](PSP-SIGNATURE-2.0.md), `contentType: "json"`, an authorized registered section type, and the complete schema and declarations inside `data`. Include the binding and policy parameters inside signed data or protected attributes and compare them with trusted execution context. Verify original signed bytes before CDL token normalization. The informal `x-cdl-signature` example in CDL 1.5 §9 is not an alternative interoperable signature format for this profile. Authenticated local policy stores may provide equivalent integrity and scope without a portable signature. Do not follow an untrusted declaration's validation URL to establish authority.

## 2. Tokens, limits and finite vocabulary

For each of `x-cdl-classes`, `x-cdl-covenants`, and `x-cdl-capabilities`:

1. An absent property means an empty local declaration. `null`, booleans, numbers, objects and nested arrays are invalid.
2. A string is split on ASCII whitespace HT, LF, VT, FF, CR and space. An array contains individual string tokens; trim ASCII whitespace at each element's ends, but reject embedded whitespace. Ignore empty elements.
3. Convert ASCII A-Z to a-z. Tokens match `[a-z0-9]+(?:-[a-z0-9]+)*`; one initial `!` is allowed only for covenants. No Unicode folding, punctuation substitution, fuzzy matching, comma splitting or inferred synonyms is permitted.
4. Deduplicate and sort by ASCII code point for deterministic reporting. Maximum token length is 128 ASCII characters including `!`, maximum raw declaration length is 65,536 UTF-8 bytes, maximum array length and split-token count are 1,024 before deduplication, and maximum path length is 64 nodes. Exceeding a limit is `LIMIT_EXCEEDED`, never truncation.
5. Reject duplicate JSON property names before object decoding loses them. Invalid Unicode or invalid JSON is `INVALID_DECLARATION`. A term and its negation in the same node are `CONTRADICTORY_DECLARATION`, independent of order.

Recognized classes, covenants, capabilities and directed implications are exactly those in the policy table. A syntactically valid unrecognized term in ANY declaration, including a negated term, is `UNSUPPORTED_TERM`. This includes otherwise valid CDL vocabulary outside this finite profile, custom terms, unregistered agreement types, and HL7 URI/code bindings. No term may be silently dropped. An extension requires a separately versioned, authority-approved profile with explicit rules and vectors; a payload cannot install an extension.

Classifications accumulate. Except for the two explicit AI-class rules in the table, a class does not invent a covenant. For example, `phi` does not silently become `hipaa`, and `public` does not remove `confidential`. Applications MUST apply their own trusted classification-to-policy mapping before this gate if they require one. These class names and compliance capabilities do not establish legal conclusions.

## 3. Inheritance and authorized negation

Evaluate an applicable schema path from root to leaf, retaining every covenant's originating declaration and authority, not just its name. At each node:

1. Add local classes to inherited classes; class negation is invalid.
2. Validate all local covenant tokens, including contradictions and unsupported terms, before changing state.
3. For each local `!term`, require that `term` exists in the incoming inherited state. Otherwise return `INVALID_NEGATION`.
4. Remove that inherited term only if trusted grants cover EVERY live originating contribution at this path. Each grant identifies the originating declaration, exact covenant, exact descendant schema path and authorized child policy revision, under the binding in §1. Missing authority returns `UNAUTHORIZED_NEGATION`; do not ignore the attempted removal. The data custodian or its explicitly delegated policy administrator issues grants. Signing a child declaration or having a numerically stronger PSP trust level alone does not grant this power.
5. Add local positive covenants with their provenance. Pass the resulting state to children.

An authorized removal remains removed down that branch until a descendant explicitly adds the covenant again. Siblings retain their own inherited state. Local declaration ordering has no effect. Empty child declarations remove nothing. Multiple independent policies concerning the same data remain conjunctive: a grant for one policy cannot erase another policy's restriction.

The initial schema attachment subset is root, `properties` and homogeneous `items`, walking the actual data location. Missing child annotations inherit parent policy. Unspecified properties and array members MUST retain their containing policy. JSON Schema references, combinators, conditional/dependent schemas, tuple items and other applicators require a separately specified resolution adapter; without one, return `UNSUPPORTED_SCHEMA` instead of skipping possibly applicable declarations. Do not fetch remote references automatically. Object-to-instance/schema attachment and resource limits require parser tests in the portable core milestone.

For a composite operation, resolve every contributing data item separately, then require ALL item decisions to allow. Flattened sets are for diagnostics only: retain origin-specific parameters, grants and legal-basis groups. Derived text, summaries, embeddings and transformed outputs inherit all contributing policies unless an authorized transformation explicitly issues a replacement policy. Redaction or summarization performed by a model does not itself remove covenants.

## 4. Capability aggregation and implications

Union all applicable, authenticated capability declarations from server, tool, sidecar, agent and transitive callees. Tool-specific or response-time declarations MUST NOT subtract server or earlier applicable capabilities. `!capability` is invalid. Reachable callees contribute their possible side effects even when they are not directly called by the model. Missing callee discovery produces `INCOMPLETE_CAPABILITIES`.

Expand the directed `implications` table to a fixed point. Cycles are harmless set closure; evaluate each term at most once. Section B.4's topic groupings are not bidirectional equivalence classes: in-transit encryption does not imply at-rest encryption, PHI handling does not imply regulatory compliance, and one authorization check does not imply another. The profile deliberately uses conservative implication edges for storage, logging, display and transmission. Capability-based denials may reject a tool whose prohibited feature would not have been used; a narrower invocation mode needs its own authenticated, enforced capability snapshot.

A positive assurance advertised by one callee MUST NOT satisfy an obligation for other participants. In addition to matching capabilities, every positive requirement needs the bound trusted check described below, covering the entire relevant operation. Discovery proves neither execution of a safeguard nor coverage of all downstream handlers.

## 5. Normative matrix interpretation

The policy table gives every Appendix B.2/B.3 row an explicit rule or finite expansion. `appendixCoverage` records the source row and its rule identifiers. B.4 is resolved by the directed implications and the non-equivalence rule above. Entries elsewhere in CDL 1.5 without a rule are unsupported, not assumed satisfied.

Each rule has these meanings (absent fields are inactive):

| Field | Required interpretation |
| --- | --- |
| `conflictAny` | Deny if any listed capability is present after closure. |
| `conflictUnless` | If `any` intersects capabilities and no `unlessAny` capability is present, deny. A guard capability alone does not waive its required check. |
| `requireAll` | Every listed capability must be present. |
| `requireAny` | At least one listed capability must be present. |
| `check` | Trusted infrastructure must report this exact check `satisfied` for this operation. Missing, stale, failed or unknown evidence cannot satisfy it. |
| `checkWhenAny` | Require `check` only when any listed capability is present. |
| `parameter` | Apply the role or jurisdiction algorithm in §6. |
| `group` | Evaluate as a member of the explicit per-resource alternatives group in §7. |
| `forbidProcessing` | Deny every data-processing operation; metadata-only policy inspection is outside data dispatch. |

Conflicts take precedence over positive assurances. There is no global "most permissive wins" for policy decisions. Examples: `transient-processing-only` does not cancel `can-write-storage`; encryption does not authorize an otherwise prohibited transfer; audit support does not waive `no-log` or `no-persist`.

The following choices resolve ambiguities or contradictions in the baseline:

- `audit-required` accepts either `logs-operations` or `creates-audit-trail`, plus an operation-bound audit check. Logging and audit-trail capabilities imply persistence. An incompatible `no-persist` operation must be refused or redesigned under an authorized policy.
- `encryption-required` requires BOTH `encrypts-at-rest` and `encrypts-in-transit`; `encryption-in-use` accepts EITHER `encrypts-in-use` or `supports-secure-enclave`. Both require their own trusted check.
- `hipaa` requires BOTH `hipaa-compliant` and `can-process-phi`, plus a trusted `hipaa` check. That check records acceptance under the custodian's policy; it is not this project's legal certification. Other compliance-named checks have the same limit.
- `redacted-display-only` requires `supports-redaction` and a trusted check that the selected enforced output route applies the authorized transformation before release. A raw-display capability without redaction support conflicts. `summary-only-display` likewise requires an enforced summary route; summarization alone does not prove non-disclosure.
- `no-disclosure-to-subject` conflicts with `discloses-to-data-subject` unless `gates-subject-disclosure` is present AND the conditional check confirms subject disclosure is blocked for this operation. Gating is not permission to disclose despite the prohibition. An authorized exception must change the effective policy before evaluation.
- `no-collect` forbids delivering data to a receiving processor, following §8.3's prohibition on ingestion. B.3's `transient-processing-only` entry cannot make prohibited ingestion permissible. Use `no-derived-collection` for ephemeral processing with no retained derivatives; persistence capabilities conflict with this profile's ephemeral requirement, and a transient-processing claim does not override them.
- Finite agreement types are `baa`, `dua` and `mou`. A generic agreement capability does not satisfy a specific type; verified specific types imply the generic capability, but a separately required generic check still needs evidence.

Checks distinguish a capability from evidence that its condition holds. For ongoing or future duties (audit, deletion, attribution, redaction), `satisfied` means the trusted executor has installed the necessary enforceable control for this exact operation and will enforce/verify completion. A declaration, unchecked promise, or model assertion cannot produce that status. If the host cannot enforce the duty, it MUST deny. Failure after dispatch must stop dependent work and output release, record the failure and use available recovery; it cannot retroactively undo an irreversible disclosure. Services must define these receipts and enforcement hooks in M3.

## 6. Roles and jurisdictions

`role-restricted-display` requires `checks-operator-role`, its trusted check, and a nonempty `allowedRoles` set supplied by the authenticated governing policy. The current principal's authenticated role set must intersect that set. Roles are exact case-sensitive strings; no inferred hierarchy (for example, physician assistant is not physician). Missing parameters or authenticated identity facts are `MISSING_CONTEXT`; a known mismatch is `ROLE_MISMATCH`. When separate policies supply role restrictions, each must be satisfied. Merely advertising role checking never authorizes the operator.

`within-jurisdiction-only` requires a nonempty `allowedJurisdictions` set in governing policy and a complete nonempty `processingJurisdictions` set from trusted discovery, covering storage, logs, backups and transitive processors. Every processing jurisdiction must be allowed. Each processing location must also have its matching capability; this revision recognizes only `processes-in-jurisdiction-eu` and `processes-in-jurisdiction-us`. Additional codes require a profile revision. A capability naming a jurisdiction absent from the supposedly complete processing set makes the snapshot inconsistent (`INVALID_CONTEXT`). Missing sets are `MISSING_CONTEXT`, a location outside policy is `JURISDICTION_MISMATCH`, missing capabilities are `REQUIREMENT_UNSATISFIED`, and absent trusted evidence is `CHECK_UNSATISFIED`. Choosing one allowed location cannot conceal another disallowed location.

Parameters are scoped to their originating policy and cannot be supplied or widened by an untrusted child, tool or LLM. This profile does not interpret arbitrary `{role}-only` or jurisdiction strings heuristically.

## 7. Legal-basis alternatives

The six `lawful-basis-*` entries marked `group: "article6"` in the table form an OR group WITHIN one originating declaration occurrence: one schema node in one authenticated policy bundle. At least one declared member must have both its required capability and its own satisfied check. Undeclared bases do not count. If none succeeds, return `LEGAL_BASIS_UNSATISFIED` instead of separate per-member requirement/check errors. All other covenants remain conjunctive.

Preserve that group's origin during inheritance. A child adding another basis creates an additional group; it MUST NOT widen the parent's alternatives. For example, inherited `lawful-basis-consent` plus child `lawful-basis-contract` requires both groups to pass. To replace the inherited restriction, an authorized negation must remove the originating contribution under §3 before the replacement is evaluated. Multiple bases deliberately declared together at one node remain alternatives.

The profile adds the missing `verifies-vital-interests` capability/check mapping explicitly. The two special-category terms `lawful-basis-explicit-consent` and `lawful-basis-substantial-public-interest`, and custom legal bases, remain unsupported in this revision; they MUST NOT be folded into the Article 6 OR group. Multiple input resources and multiple policy origins on the same resource retain separate groups. A valid basis for resource A cannot authorize resource B. An unsupported declared alternative still fails closed even when a known alternative is satisfied. This is a rule for evaluating policy declarations, not an automated determination of lawful processing.

## 8. Evaluation order and result contract

Run stages in this order. Stop at the first failing stage, report all distinct reason codes within it in the listed order, and return no partial authorization:

1. Input: `INVALID_DECLARATION`, `LIMIT_EXCEEDED`, `CONTRADICTORY_DECLARATION` → `deny`.
2. Support: `UNSUPPORTED_TERM`, `UNSUPPORTED_SCHEMA` → `unsupported`.
3. Trusted snapshot: `UNTRUSTED_DECLARATION`, `SCOPE_MISMATCH`, `STALE_CONTEXT`, `INCOMPLETE_CAPABILITIES`, `INVALID_CONTEXT` → `deny`.
4. Inheritance: `INVALID_NEGATION`, `UNAUTHORIZED_NEGATION` → `deny`.
5. Deployment: `TOPOLOGY_INSUFFICIENT`, `MEDIATION_INCOMPLETE` → `deny` (companion profile).
6. Prohibitions: `PROCESSING_PROHIBITED`, `CAPABILITY_CONFLICT` → `deny`.
7. Obligations: `MISSING_CONTEXT`, `ROLE_MISMATCH`, `JURISDICTION_MISMATCH`, `REQUIREMENT_UNSATISFIED`, `CHECK_UNSATISFIED`, `LEGAL_BASIS_UNSATISFIED` → `deny`.
8. Otherwise `allow`, with an empty reason-code array.

Within one rule, missing required context suppresses its dependent mismatch/check tests; a known parameter mismatch suppresses its capability/check tests; missing capabilities suppress that rule's check test. Distinct rules are still evaluated. Class rules follow the same stages as covenant rules. A host must also detect malformed context at stage 3; stage 7 missing context denotes well-formed but unavailable facts. For multiple resources, choose the earliest failing stage across all resources and combine only that stage's distinct reasons in profile order. Each resource's decision must allow before dispatch can proceed.

The table's `reasonStages` fixes ordering. Diagnostic effective sets are sorted; they are not a substitute for origin records. Public error messages MUST avoid returning governed data or secret policy details. Conformance adapters will use the vector operation/result shapes; these are test interfaces, not HTTP or MCP service contracts.

## 9. Compatibility and remaining work

Adoption is explicit: record base CDL 1.5, this profile revision, the table digest, and the companion enforcement profile in deployment configuration. Re-evaluate cached decisions when any of these changes. Never silently fall back to semantic interpretation or a weaker topology. Existing policies may now deny because of unknown terms, missing checks, incomplete capabilities or unauthorized negations; migration requires authority-reviewed policies and capability/check integrations, not disabling rejection.

This profile and its tables close the specified interpretation gaps. Production parsing, trusted-store adapters, check receipts, service contracts, full RFC requirement extraction, fuzzing, cross-language decision execution and effectiveness evaluation remain implementation work. No current scaffold is certified by these vectors.

Dedicated to the public domain under CC0 1.0 Universal; see [license](../../LICENSES/CC0-1.0.txt).
