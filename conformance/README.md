# Conformance

The [requirement review](../specs/reviews/PSP-CDL-REVIEW-0.1.md) audits all 443 uppercase RFC keyword occurrences and retains explicit blocked/unimplemented obligation status; extraction is not conformance. All five seed vectors remain draft expectations. Four now have scoped mappings in the [offline workflow matrix](../docs/workflow-matrix.md); CDL-002 remains blocked. The harness reports inventory separately and the default full-conformance command still exits 2. Blocked, unsupported, skipped, and error outcomes must never become passes.

M1 expands the register to every normative clause and establishes exact cryptographic byte vectors. M2 implements adapters consuming identical JSON inputs and compares complete decisions and reason codes. Later integration cases must assert that denied calls never reach downstream tool spies. Result records follow schemas/result.schema.json. Effectiveness runs follow evaluation/PROTOCOL.md.

## Signature profile fixtures

PSP Core 3.2.0 selects PSP Signature Profile 2.0. The shared file at vectors/signatures/profile-2.0.json contains proposed-standard byte/crypto fixtures. Node and Python independently check exact JCS bytes, Ed25519/HMAC results, metadata tampering, equivalent representations, encoding and time boundaries. Node also checks the envelope schema. All embedded keys are public synthetic test material and must never be used in a deployment.

Run npm run test:signatures and the Python unittest suite. These are fixture-oracle checks, separate from the executable reusable library adapters in `--profiles`. The five original seed vectors remain draft.

## Policy and enforcement profile fixtures

[CDL Deterministic Policy Profile 1.0](../specs/profiles/CDL-DETERMINISTIC-1.0.md) selects [the finite policy table](policy/cdl-1.0.json); [PSP Trust and Enforcement Profile 1.0](../specs/profiles/PSP-TRUST-1.0.md) selects [the enforcement table](policy/enforcement-1.0.json). The policy table accounts for all 118 Appendix B.2/B.3 rows through 88 explicit rules, including finite pattern expansion and documented corrections.

[Shared decision vectors](vectors/policy/profile-1.0.json) pin the policy table's exact SHA-256 and provide expected outcomes for the TypeScript/Python library adapters. The fixture inputs are synthetic representations of already authenticated host facts; accepting their `checks` or `grants` directly from an API caller would be unsafe. The [vector interface](policy/README.md) describes their scope and operation shapes.

Run `npm run test:policy` for schema, matrix-coverage, reference and restricted matrix-algebra audits. Python independently reads the artifacts, checks their digest and coverage, and checks result ordering. These checks do not exercise production parsing, signature/provenance validation, grant authorization, check execution or dispatch. The baseline corpus retains its original `executionStatus: unimplemented` authoring-time marker; it is an expectation artifact, not a live result. Current execution is reported separately by `--profiles`: 315 policy/trust cases, 143 codec checks and 53 signature checks, all through reusable public APIs. The expanded inventory preserves the five original workflow seed references and their pending status; scoped workflow mappings are recorded separately in the matrix. Library execution does not imply that a proxy or service has performed enforcement.

## Reversible codecs and interchange

[Codec vectors](vectors/codec/profile-1.0.json) cover hand-authored markup, 80 seeded generated object trees, malformed markup/JSON and CDL schema transport. `npm run conformance:profiles` and `python -m psp_cdl_test_harness --profiles` execute all library profiles. `python scripts/check-parity.py` compares complete reports, then independently produces and consumes actual markup, JSON, signed envelopes and CDL representations in both directions. These reports use the documented profile adapter format; the offline workflow matrix now embeds the generic result schema in each cell.

## Read-only service slice

[Service fixtures](vectors/services/profile-0.1.json) are draft expectations for 33 HTTP cases executed independently in both languages. `scripts/check-service-parity.py`, invoked by the existing parity check, also compares MCP transcripts and uses actual mixed-language HTTP/stdio peers. These are distinct from the 511 library-profile checks and from the scoped workflow seed mappings. No durable state, replay-safe mutation or proxy dispatch is exercised.

## Automatic prompt refresh

[Refresh vectors](vectors/llm/refresh-0.1.json) contain 64 draft behavioral cases
and eight SemVer comparisons for [Prompt Refresh 0.1](../specs/profiles/PSP-PROMPT-REFRESH-0.1.md).
Both language suites execute them. `scripts/check-refresh-parity.py` compares
exact transcripts, metadata, audit events and turn commands, then exercises
mixed-language process restarts, expired-prompt retrieval, rollback recovery and
five metadata/turn races. These scoped checks do not establish full RFC refresh
conformance or measured effectiveness. The original full-workflow harness remains
explicitly unimplemented.
MCP prompt-refresh discovery adds 29 shared boundary vectors and seven shared loop scenarios in `vectors/llm/mcp-refresh-0.1.json`. `scripts/check-mcp-refresh-parity.py` compares exact wire arguments and decisions and runs 32 real mixed-language stdio/HTTP calls, including authentication denial and observed catalog drift. This is scoped draft coverage; full workflow conformance remains pending.
