# Policy profile artifacts and fixture interface

The normative [CDL profile](../../specs/profiles/CDL-DETERMINISTIC-1.0.md) selects `cdl-1.0.json`. The [trust/enforcement profile](../../specs/profiles/PSP-TRUST-1.0.md) selects `enforcement-1.0.json`. JSON files use UTF-8 without BOM and LF line endings. The vector corpus pins SHA-256 of the exact policy-table file bytes, including the final newline; editing the table requires reviewing and updating its vectors and digest together.

The [shared corpus](../vectors/policy/profile-1.0.json) supplies synthetic inputs and expected outcomes. It is a proposed-standard test interface, not an HTTP request schema, capability credential, or proof of execution. `checks`, `grants`, parameters, roles and discovery facts represent already authenticated, bound host state. Production adapters must construct those facts from their own authorities. The suite's assumptions never waive those runtime requirements.

| Operation | Input and expected output |
| --- | --- |
| `normalize` | A declaration `kind` and raw `declaration`; allow returns sorted `tokens`. Invalid inputs intentionally appear in the corpus. |
| `inherit` | Ordered root-to-leaf `path` nodes with declaration IDs, schema JSON Pointers and optional `classes`/`covenants`, plus prevalidated `grants`; allow returns effective class/covenant sets. Each grant's source ID, term and exact target path match one origin. Revision/tenant/principal binding is an adapter precondition, not omitted authority. |
| `aggregate` | Authenticated capability `sources` and inventory `complete`; allow returns their union with directed implication closure. Source order grants no override power. |
| `evaluate` | One resource/origin unit's `classes`, `covenants`, `capabilities`, trusted `checks`, `parameters`, and `context`; returns the profile decision and ordered reason codes. A unit contains one originating declaration occurrence's legal-basis group. Positive checks are `satisfied`, `failed` or `unknown`; absence is unsatisfied. |
| `evaluate-batch` | Separate resource/origin units in `resources`, evaluated conjunctively. Multiple entries may concern the same physical resource but distinct ancestor/child or independently supplied policy origins. Keep legal-basis alternatives and parameters local to their origin. The batch fixtures each contain one failing unit; future multi-failure cases must follow the batch combination rule below. |
| `enforcement` | Trusted `topology`, governing `minimumTopology` and operational `gates`; compare the minimum (at least B), then require every gate for the selected topology. |
| `trust` | `signed` means cryptographic verification already succeeded; `allowedLevels` comes from the scoped authority registry. A missing signed `claimedLevel` uses 2; it still needs authorization. Unsigned claimed levels have no authority; assign 4 or 5 from trusted user/external routing. |
| `engine-isolation` | A proxy-only mechanism returns `unsupported`; this corpus does not certify any inference engine. |

All operations return `decision` and `reasonCodes`. Allows have no reason codes. Failures stop at the first failing stage specified in the profile. Within a batch, select the earliest failing stage across resources and report the distinct reasons from that stage in profile order; if that stage is support detection return `unsupported`, otherwise `deny`. No allow from another resource can cancel a failure. Apply validation/support to every resource before any dispatch; short-circuiting on an allow is invalid.

Short fixture keys (`classes`, `covenants`, `capabilities`) stand for the corresponding `x-cdl-*` properties. They do not introduce new CDL wire aliases. Each positive or negative matrix fixture names applicable `ruleIds`. All Appendix B.2/B.3 rows have table mappings, including explicit exceptions; this does not claim every other CDL term is supported.

Node checks schemas, references, source-row coverage and restricted matrix algebra. Python independently checks artifact decoding, exact digest, coverage and result order. Normalization, inheritance and trust vectors are expectations for future production adapters; current artifact checks do not establish their runtime correctness. No production proxy or policy engine is being executed.

Dedicated to the public domain under CC0 1.0 Universal; see [license](../../LICENSES/CC0-1.0.txt).
