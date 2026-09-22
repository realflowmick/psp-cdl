# PSP Trust and Enforcement Profile 1.0

Status: Proposed Standard, author-directed implementation profile, September 22, 2026.

Profile identifier: `PSP-TRUST-1.0`. Bases: [PSP Core 3.2.0](../psp/RFC-PSP-CORE-v3_2_0.md) and [CDL 1.5](../cdl/RFC-CDL-v1_5.md). Companion: [CDL Deterministic Policy Profile 1.0](CDL-DETERMINISTIC-1.0.md).

This profile resolves PSP-E005 and CDL-E001 for adopters. It takes precedence over the baseline's count of "five" levels, unconditional attention-isolation wording, and independent-layer guarantees. Archived RFCs remain unchanged; selection of this profile MUST be explicit.

## 1. Six trust levels

| Level | Name | Meaning |
| --- | --- | --- |
| 0 | Platform | Inference-engine/platform enforcement, reserved to that authority. |
| 1 | Governance | Authorized organizational policy. |
| 2 | Session | Authorized application/workflow instructions. |
| 3 | Context | Verified data from authorized sources. |
| 4 | User | Authenticated user input; authentication does not grant instruction authority. |
| 5 | External | Untrusted sources, uploads and external free text. |

There are exactly SIX integer levels, 0 through 5. Lower numbers indicate stronger authority. A level is provenance metadata, not proof of model behavior. Registry/source policy MUST authorize both the claimed level and section type in the execution scope; reject unauthorized claims rather than silently relabeling signed metadata. A valid signature from a level-5 source does not turn its content into governance. Text that says "SYSTEM", a forged delimiter, a tool's self-description, or a model's asserted role cannot establish authority.

Only explicitly configured platform authority can issue level-0 material. A proxy MUST NOT claim inference-engine enforcement merely by creating a level-0 prompt section. Verified structured fields may be level 3 while externally supplied free text in the same response remains level 5; a trusted transport alone does not promote those fields.

Unsigned authenticated user input defaults to level 4; unsigned external content defaults to level 5, according to trusted source routing. The signature profile's omitted `trustLevel` default of 2 is a signed-envelope normalization rule, usable only after signature AND key/scope authorization; it is never an unsigned-input default. Likewise, the signature profile's priority default is 50. PSP §30.7's per-level priority values are authoring suggestions, not alternative verification defaults. Priority MUST NOT grant cross-level authority or weaken covenants.

A transformation conservatively retains the least trusted participating provenance (maximum numeric level) and all contributing data policies unless an authorized, audited transformation explicitly changes the classification. Generating a summary or signing a model response alone does not make its source data more authoritative. Trusted controls may deliberately consume lower-trust data under validated schemas and explicit policy; the no-escalation rule does not forbid all useful data flow.

## 2. Proxy controls and inference-engine controls

Reference proxies MUST enforce their own deterministic boundaries: signature/key/time checks; tenant, session and active-node binding; node/tool allow-lists; transition-source qualification; CDL checks before data crosses a governed boundary; output gating; and policy-version checks before side effects. They MUST keep private keys, credentials and authoritative policy/session state outside model-visible input.

These controls do not by themselves enforce attention masks, model-internal priority weighting, non-interference, resistance to every prompt injection, or system-prompt confidentiality once text is given to the model. Baseline statements about hard attention isolation apply only to an inference engine with an explicitly implemented and separately evaluated isolation mechanism. A proxy-only deployment MUST report that mechanism as `unsupported`, not emulate its guarantee with instructions. Any engine claim must identify the engine/version, supported isolation semantics and evaluation evidence.

Instruction ordering and role separation can be evaluated as defenses, but MUST NOT be reported as hard isolation. Output inspection alone is not proof that arbitrary secrets cannot be paraphrased or encoded. Deployments requiring such confidentiality must keep those secrets outside the model and mediate actual release paths.

## 3. Topology claims and downgrade prevention

| Topology | Enforcement boundary | Permitted claim |
| --- | --- | --- |
| A | Model semantic interpretation only | Best-effort model behavior, with no deterministic dispatch guarantee. |
| B | Authoritative host owns inference requests, dispatch and output release | Deterministic rejection at the covered host boundaries, conditional on complete mediation and trusted inputs. |
| C | B plus MCP proxy and governed servers | Additional enforcement points with explicitly documented coverage and shared dependencies. |

`CDL-DETERMINISTIC-1.0` requires at least B. A deployment may experimentally run A, but MUST NOT label it deterministic-profile enforcement. Governing policies may require C. The effective minimum is the strongest of all applicable authenticated requirements; an untrusted artifact or descendant cannot lower it.

The [enforcement table](../../conformance/policy/enforcement-1.0.json) defines required gates. B requires pre-inference data checks, tool dispatch checks, output release checks, bound policy state and mediated side effects. C requires all B gates plus MCP-proxy dispatch checks and server output checks. Gate status means an operational, trusted enforcement point, not a configured URL or a tool's claim. Compare the selected topology against the minimum first; then require every gate for the selected topology. Missing coverage is `MEDIATION_INCOMPLETE`. A nominal C deployment with a failed server gate cannot relabel itself B to bypass a required gate.

Complete mediation includes provider requests, tools and their reachable callees, logs, caches, storage, notifications, error output and streaming. Evaluate protected data before sending it to an inference provider; an output check cannot retract a prompt disclosure. Buffer governed streaming output until the release policy is satisfied. Unknown paths, bypasses or unavailable gates MUST stop the affected operation. Changing topology, tool/provider revision or policy state invalidates pending decisions.

No fixed number of independent failures is required for a violation: one bypass or dishonest capability declaration may suffice. Layers may share code, keys, configuration and infrastructure; their failures can be correlated. Do not multiply layer success rates or claim superiority to other architectures without measured evidence. Neither signed declarations nor this topology profile establish that a remote processor honors its promises after receiving data.

## 4. Acceptance evidence

Future integration tests MUST observe actual provider/tool calls and output bytes: a denied operation never reaches its downstream spy; a stale decision cannot dispatch; no governed streaming bytes precede release; missing gates and topology downgrades fail closed. Tests must exercise transitive calls and common-mode failures, with useful benign controls. Model refusal language is not evidence that a side effect was prevented.

The [shared vectors](../../conformance/vectors/policy/profile-1.0.json) specify topology and trust expectations. Current checks validate artifacts; production adapters and effectiveness measurements remain pending. Follow the [evaluation protocol](../../evaluation/PROTOCOL.md) before publishing security-effectiveness claims.

Dedicated to the public domain under CC0 1.0 Universal; see [license](../../LICENSES/CC0-1.0.txt).
