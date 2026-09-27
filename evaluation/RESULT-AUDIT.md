# Offline signed-result audit

After [signing and host-trust setup](SIGNED-RESULTS.md), a reviewer can reproduce
the saved outcomes, grading details and analysis without rerunning any trial:

```powershell
uv run --locked python scripts/result-manifest.py audit --directory $runDirectory --signed .artifacts/signed-result.json --trust $hostTrustPath
node scripts/result-manifest.mjs audit --directory $runDirectory --signed .artifacts/signed-result.json --trust $hostTrustPath
```

Both commands verify the signature, exact artifact bytes, bindings and complete
directory inventory, then print the same JSON report. They write no evidence or
signature files. The Python repository CLI also needs Node and installed workspace
dependencies for the existing executor-manifest schema check.

| Exit | Meaning |
| --- | --- |
| 0 | All three derived documents reproduce from the authenticated saved evidence. |
| 1 | Authenticated files differ from their reproduced calculation; `checks` identifies them by name and canonical hash. |
| 2 | Invalid trust, integrity, evidence, unsupported input or local state; no reproduction verdict. |

The report binds to the signed envelope, bundle, plan and corpus. It preserves
source drift, recovery status, skipped/cancelled trials and unknown outcomes.
Recovered results use the executor's record/observation/partial-log precedence.
Even re-signed changes to outcomes or statistics cause a mismatch unless the
installed calculation reproduces them from the saved evidence.

This is a calculation check. It does not verify worker observations against the
real world, recalculate usage/latency summaries, reexecute pinned source, establish
independent review or approve a study. These limits appear in every report. A
source-invalid run remains invalid even with exit 0. Archive the auditor commit
and runtime with any report; the report is unsigned and the calculation uses
installed code. Evidence is limited to 64 MiB per audit and 4 MiB per artifact.

TypeScript exports `auditResultManifest(envelope, policy, readArtifact)`; Python
exports `audit_result_manifest(envelope, policy, read_artifact)`. The policy and
reader match the signed-result API. Each artifact is read once into a detached
bounded snapshot, after verification of host trust. Libraries require no file
access or repository checkout. See the [draft contract](../specs/profiles/RESULT-AUDIT-0.1.md)
and [report schema](../schemas/result-audit-0.1.schema.json).

Shared [public audit vectors](../conformance/vectors/evaluation/result-audit-0.1.json)
cover interrupted evidence, mismatches after re-signing, trust/integrity failures,
invalid ordering and unknowns. `scripts/check-result-parity.py` compares complete
reports across languages; full parity also audits the actual 96-trial public
rehearsal through both CLIs. Package-consumer checks exercise the installed APIs.
No real held-out corpus or live provider is involved in these checks.
