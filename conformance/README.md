# Conformance

The requirement register is a starter inventory, not exhaustive normative coverage. All five seed vectors are draft expectations pending review; no adapter executes them yet. The harness reports inventory separately and exits 2 for an attempted unimplemented run. Blocked, unsupported, skipped, and error outcomes must never become passes.

M1 expands the register to every normative clause and establishes exact cryptographic byte vectors. M2 implements adapters consuming identical JSON inputs and compares complete decisions and reason codes. Later integration cases must assert that denied calls never reach downstream tool spies. Result records follow schemas/result.schema.json. Effectiveness runs follow evaluation/PROTOCOL.md.

## Signature profile fixtures

PSP Core 3.2.0 selects PSP Signature Profile 2.0. The shared file at vectors/signatures/profile-2.0.json contains proposed-standard byte/crypto fixtures. Node and Python independently check exact JCS bytes, Ed25519/HMAC results, metadata tampering, equivalent representations, encoding and time boundaries. Node also checks the envelope schema. All embedded keys are public synthetic test material and must never be used in a deployment.

Run npm run test:signatures and the Python unittest suite. These are fixture-oracle checks, separate from the still-unimplemented production conformance adapters. The five original seed vectors remain draft.

## Policy and enforcement profile fixtures

[CDL Deterministic Policy Profile 1.0](../specs/profiles/CDL-DETERMINISTIC-1.0.md) selects [the finite policy table](policy/cdl-1.0.json); [PSP Trust and Enforcement Profile 1.0](../specs/profiles/PSP-TRUST-1.0.md) selects [the enforcement table](policy/enforcement-1.0.json). The policy table accounts for all 118 Appendix B.2/B.3 rows through 88 explicit rules, including finite pattern expansion and documented corrections.

[Shared decision vectors](vectors/policy/profile-1.0.json) pin the policy table's exact SHA-256 and provide expected outcomes for future TypeScript/Python adapters. The fixture inputs are synthetic representations of already authenticated host facts; accepting their `checks` or `grants` directly from an API caller would be unsafe. The [vector interface](policy/README.md) describes their scope and operation shapes.

Run `npm run test:policy` for schema, matrix-coverage, reference and restricted matrix-algebra audits. Python independently reads the artifacts, checks their digest and coverage, and checks result ordering. These checks do not exercise production parsing, signature/provenance validation, grant authorization, check execution or dispatch. The corpus explicitly reports `executionStatus: unimplemented`; the scaffold harness inventory still lists only the five original seed vectors. Wiring both profile corpora into executable conformance adapters is M2 work.
