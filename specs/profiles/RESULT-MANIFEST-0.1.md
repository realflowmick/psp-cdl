# Signed Result Manifest 0.1

Status: **project draft**, opt-in evaluation artifact contract. License: CC0-1.0.

This contract supplies signed-result infrastructure for roadmap M6 and issue
#49. It does not amend PSP Core 3.2.0, CDL 1.5, PSP Signature Profile 2.0 or the
existing `heldout-execution-result-0.1` format. An archival result signature is
distinct from a PSP section signature and never authorizes inference, tool use,
collection, publication, normative adoption or release.

## Envelope and signed bytes

The envelope has exactly `manifest` and `signature`. Its structural companion is
[`result-manifest-0.1.schema.json`](../../schemas/result-manifest-0.1.schema.json).
Reject duplicate JSON members before parsing can discard them, unknown fields,
invalid Unicode, unsafe integers, nonfinite numbers and unsupported versions.
Use the core's bounded JSON reader (4 MiB, depth 256, 100,000 values). Do not apply
Unicode normalization. Equivalent object key order and number spellings produce
the same RFC 8785 representation; artifact **file** bytes remain exact.

`signature` contains exactly:

| Field | Required value |
| --- | --- |
| `profile` | `result-ed25519-0.1` |
| `algorithm` | `ed25519` |
| `keyId` | 1–128 ASCII characters matching `[a-z0-9][a-z0-9._-]*` |
| `signedAt` | Integer Unix seconds, 0–9,007,199,254,740,991 |
| `value` | 64 signature bytes, canonical unpadded base64url (86 characters) |

Remove only `signature.value` and sign:

```text
UTF8("PSP-CDL-RESULT-MANIFEST-0.1\n") ||
UTF8(JCS({"manifest": manifest, "signature": remaining_signature_fields}))
```

The prefix ends with one LF byte. There is no BOM, trailing newline, alternate
formula, prehash, algorithm fallback or embedded signing key. Use standard
Ed25519 implementations. Every key-selection and signing-time field is covered.
A different protocol, domain or algorithm requires a new profile.

## Manifest and inventory

The manifest contains exactly `schemaVersion: 1`,
`scope: "signed-result-manifest-0.1"`, `bundleSha256`, `planSha256`,
`corpusSha256`, `mode`, `status`, `recovered`,
`evidencePolicy: "local-synthetic-raw-0.1"`, `fullStudy: false`,
`independentReview: false`, `executionAuthorized: false` and `artifacts`.
Copy the three object digests, mode (`offline`/`live`), source status
(`finalized`/`invalid-source-changed`) and recovery flag from the unsigned
executor manifest. Object digests use SHA-256 of UTF-8 JCS without a newline.

Each descriptor has exactly `path`, `bytes` and `sha256`. Hash exact file bytes,
including newlines. Length is an integer from 0 to 4,194,304. Digests are 64
lowercase hex characters. Entries are unique and strictly sorted by ASCII path.
At most 25,001 entries are permitted, subject to the aggregate JSON limits above.
No path normalization or URI retrieval is allowed.

Required names: `manifest.json`, `bundle.json`, `corpus.json`, `outcomes.json`,
`grading.json` and `analysis.json`. Live results require `operator-admission.json`;
offline results prohibit it. Other permitted names are four decimal digits
followed by `.record.json`, `.started.json`, `.timing.json`, `.observation.json`
or `.events.jsonl`. All other names, directory separators, alternate data streams,
traversal and absolute paths are rejected.

The unsigned source manifest remains unchanged, including `signed: false`.
Its `files` list must equal the signed inventory after removing `manifest.json`
and each byte count. Its schema, claims and copied bindings must validate.
Recompute the bundle, embedded plan and saved corpus object hashes; compare the
bundle's mode, evidence policy and plan/corpus bindings with the signed values.
Every inventoried file must exist and match its signed length and digest.

Repository CLIs also require the directory's complete `.json`/`.jsonl` inventory
to match. Non-evidence coordination files such as locks and cancellation markers
are outside this inventory. Write signatures outside the evidence directory so
they cannot recursively include themselves or alter the original manifest.
Consumers must read ordinary files under a caller-selected directory; reject
symlinks, file reparse points and hard links, with bounded reads. Operate on a
quiescent directory under host control; this is not a filesystem sandbox against
a concurrently malicious local writer.

## Trust and verification

The host supplies an independent policy with exactly `keyId`, a raw 32-byte
Ed25519 `publicKey`, `status` (`active`/`revoked`), the **expected**
`bundleSha256`, and integer `now`. CLI JSON trust records instead include
`schemaVersion: 1` and canonical base64url `publicKey`; the clock comes from the
host. Do not populate trust from the signed envelope or let it select a registry,
URL or key. The same key cannot silently authenticate a different run.

Validate the envelope and policy, check key identifier and current active status,
compare expected bundle scope, verify the signature, and reject `signedAt > now`.
Then check saved artifact bytes and bindings. Signature-only verification and
artifact verification are separate library APIs; the CLI reports
`signatureVerified` and `artifactsVerified` only after both pass.

Archival signatures have no implicit expiration, trusted timestamp, transparency
log or single-use/replay guarantee. `signedAt` is a signer assertion; it cannot
prove historical key validity or when a study ran. Hosts own identity verification,
public-key provisioning, rotation and revocation. Unknown or revoked keys are
rejected even if cryptography verifies. Encrypted private keys, multisignatures,
certificates and alternate algorithms require separate tooling/contracts.

## Meaning and limitations

A verified envelope authenticates these bytes under the host-selected key and
run scope. It does not establish the truth of the source manifest, accounting,
independent identities, methods, held-out provenance, redaction or effectiveness.
Verification does not rerun grading or analysis; reproduce those separately
using the pinned implementation and corpus. Embedded review statements remain
assertions. This contract cannot promote `fullStudy`, `independentReview` or
`executionAuthorized` to true.

Signing cancelled, skipped, recovered or source-drift evidence is allowed for
audit: preserve negative/unknown results and the original invalid status.
Verification success does not make an invalid run usable for a frozen study.
Evidence is local synthetic raw data; neither signatures nor these CLIs approve
publication. Redacted publication bundles and independent reviewer attestations
require a separately reviewed contract.

Shared [public vectors](../../conformance/vectors/evaluation/result-manifest-0.1.json)
provide exact input bytes, deterministic signatures and rejection cases. Their
published fixture key and minimal documents are test data, not study results.
