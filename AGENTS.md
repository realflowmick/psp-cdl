# Repository instructions

This project contains proposed PSP/CDL standards and paired reference implementations sponsored by RealflowCloud, Inc.

- Read README.md, ROADMAP.md, docs/architecture.md, and the relevant RFC sections before changing behavior.
- Specification sources live in specs/psp and specs/cdl. Preserve published technical baselines; record errata and versioned profiles before introducing different normative semantics.
- Do not claim security effectiveness, production readiness, or conformance from scaffold or build checks.
- Implement deterministic security controls outside model-generated text. Keep credentials and authoritative session/policy state outside model-visible inputs.
- Share schemas and test vectors across TypeScript and Python. Report blocked and unsupported cases explicitly.
- Run npm run check, the Python unittest suite, and scripts/check-parity.py for changes to shared contracts or component metadata. Extend meaningful behavior tests as implementations grow.
- Keep generated output, credentials, real customer data, and local tool runtimes out of Git.
- Specifications/schemas/shared vectors are CC0-1.0; implementation code and general docs are Apache-2.0. Follow LICENSING.md.
- Keep package publication disabled until the reviewed release milestone; a package scaffold is not a working proxy.
- Use pull requests for changes after initial repository creation. Follow the protected-main checks and current maintainer review policy.
