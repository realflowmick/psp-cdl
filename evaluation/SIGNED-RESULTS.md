# Signing and verifying local study evidence

The opt-in [Signed Result Manifest 0.1](../specs/profiles/RESULT-MANIFEST-0.1.md)
binds finalized executor artifacts with Ed25519 and an exact run scope. Both
`test-harness` libraries sign and verify the same format. This is infrastructure
for #49; no held-out study, independent review or collection approval is supplied.

Keep the executor's `manifest.json` and all saved files unchanged. Use a quiescent
evidence directory. The signature covers the manifest, bundle, corpus, outcomes,
grading, analysis and retained trial artifacts, including errors and skipped-trial
accounting. Recovered and invalid-source runs retain their status. Verification
checks integrity and bindings, not grading accuracy.

## Local CLI

Use the locked Python environment and Node 24 (Node supplies the existing
executor schema validator). Provision an Ed25519 key through host operations;
the signer accepts an unencrypted PKCS8 PEM file. Keep operational private keys
outside Git and model-visible inputs. The CLI reads no provider credential and
starts no worker, model or network request.

After finalization, explicitly sign the expected bundle hash from the preparation
record. The output parent must exist under ignored `.artifacts/`, outside the
evidence directory. Existing files are never overwritten.

```powershell
uv run --locked python scripts/result-manifest.py sign --directory $runDirectory --bundle-sha256 $expectedBundleHash --key-id $signerKeyId --private-key $hostPrivateKeyPath --output .artifacts/signed-result.json
```

Provision a separate trust file with this exact JSON shape:

```json
{
  "schemaVersion": 1,
  "keyId": "study-operator-2026",
  "publicKey": "<canonical unpadded base64url of 32 public-key bytes>",
  "status": "active",
  "bundleSha256": "<expected 64-character lowercase bundle hash>"
}
```

Placeholders are not valid keys or digests. Authenticate the public key and
expected run through host records; copying them from an untrusted envelope would
remove that trust boundary. Verify with either implementation:

```powershell
uv run --locked python scripts/result-manifest.py verify --directory $runDirectory --signed .artifacts/signed-result.json --trust $hostTrustPath
node scripts/result-manifest.mjs verify --directory $runDirectory --signed .artifacts/signed-result.json --trust $hostTrustPath
```

Exit 0 means signature and artifact checks passed (or signing completed).
Exit 2 means inputs, trust, integrity or local state were rejected. Summaries
print counts and identifiers, never keys, raw prompts or responses.
`runStatus: "invalid-source-changed"` remains invalid even with exit 0: this
authenticates audit evidence without approving its study use. There is no
expiration or trusted timestamp; key status comes from the host at verification
time. No signature authorizes a paid run or publication.

## Libraries and validation

TypeScript exports `validateResultManifest`, `resultSigningInput`,
`signResultManifest`, `verifyResultManifest` and `verifyResultArtifacts`. Python
exports snake_case equivalents. Library signers accept a 32-byte Ed25519 private
seed; verifiers require the contract's host policy. Artifact readers are
caller-supplied bounded synchronous callbacks. These APIs perform no implicit file
access, provider calls or key lookup. Parse untrusted JSON with core `parseJson`
or `parse_json` before passing objects to the APIs.

`verifyResultManifest` returns the manifest after signature and policy checks.
It does **not** check files. `verifyResultArtifacts` checks exact bytes, original
inventory and run bindings; repository CLIs additionally enforce the complete
directory inventory and existing source-manifest schema. Verification does not
independently recompute labels or statistics.

```sh
uv run --locked python scripts/generate-result-contract.py --check
uv run --locked python scripts/check-result-parity.py
uv run --locked python scripts/check-heldout-parity.py
```

The last command executes 96 public rehearsal trials, then signs and verifies
actual evidence in both language directions, tests modified/extra artifacts and
wrong run trust, and checks exclusive output creation. Temporary private keys
are deleted and never uploaded. Full parity includes this integration. Isolated
package checks exercise signatures from wheels/tarballs. Public fixture
signatures authenticate test bytes only.

Signed-contract evidence can now be pinned for preregistration review. Independent
corpus/rubric/method review, a held-out corpus, operator admission and recorded
freeze remain separate missing evidence. This contract preserves `fullStudy:
false`, `independentReview: false` and `executionAuthorized: false`.
