# Contributing

Discuss substantial work in an issue before implementation. Pick one component or specification requirement, identify its RFC citation and acceptance cases, and open a focused pull request.

1. Fork or branch from `main` and follow `docs/development.md`.
2. Preserve language parity at shared contracts and vectors. A fix in one language needs a corresponding case for the other.
3. Run `npm run check`, the Python suite, and the parity check. Add meaningful tests for new behavior.
4. Cite the requirement and document unsupported behavior; never report a skipped or blocked case as passing.
5. Sign off commits with `git commit -s`. This certifies the [Developer Certificate of Origin 1.1](https://developercertificate.org/), including your right to contribute under the destination path's license.
6. Include test evidence and compatibility effects in the PR. Normative edits follow `specs/PROCESS.md`.

Specification, schema, and conformance-data contributions are CC0-1.0; code and general docs are Apache-2.0. No copyright assignment or commercial account is required. Use synthetic data only in tests. Report exploitable vulnerabilities through SECURITY.md, not public issues.

AI-assisted contributions receive the same review and licensing requirements as any other contribution. Contributors remain responsible for correctness, provenance, and not publishing private data or credentials.
