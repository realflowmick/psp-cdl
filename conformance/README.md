# Conformance

The requirement register is a starter inventory, not exhaustive normative coverage. All five seed vectors are draft expectations pending review; no adapter executes them yet. The harness reports inventory separately and exits 2 for an attempted unimplemented run. Blocked, unsupported, skipped, and error outcomes must never become passes.

M1 expands the register to every normative clause and establishes exact cryptographic byte vectors. M2 implements adapters consuming identical JSON inputs and compares complete decisions and reason codes. Later integration cases must assert that denied calls never reach downstream tool spies. Result records follow schemas/result.schema.json. Effectiveness runs follow evaluation/PROTOCOL.md.

## Signature profile fixtures

PSP Core 3.2.0 selects PSP Signature Profile 2.0. The shared file at vectors/signatures/profile-2.0.json contains proposed-standard byte/crypto fixtures. Node and Python independently check exact JCS bytes, Ed25519/HMAC results, metadata tampering, equivalent representations, encoding and time boundaries. Node also checks the envelope schema. All embedded keys are public synthetic test material and must never be used in a deployment.

Run npm run test:signatures and the Python unittest suite. These are fixture-oracle checks, separate from the still-unimplemented production conformance adapters. The five original seed vectors remain draft.
