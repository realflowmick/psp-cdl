# Exfiltration fingerprints (PSP-EXFIL-0.1)

`@psp-cdl/api-server/exfiltration` and `psp_cdl_api_server.exfiltration` keep a
SQLite store of fingerprints of protected PSP content: application SYSTEM text and
CONTEXT payloads that must not leave a boundary. A host checks outbound text
against the store and feeds the result into its own threat accumulation and release
policy. The [draft profile](../specs/profiles/PSP-EXFIL-0.1.md) defines the
algorithm; the [schema](../schemas/exfiltration-0.1.schema.json) and
[shared vectors](../conformance/vectors/exfiltration/exfiltration-0.1.json) pin
the output in both languages.

This is an opt-in heuristic check. It does not release or block anything by itself,
it does not make the LLM's PSP interpretation authoritative, and a `clear` result is
not evidence that nothing leaked. No detection rate has been measured.

## How it works

Two tiers run over the same normalized tokens:

- **Lexical.** Five-token shingles, hashed with HMAC-SHA-256 under a host key. Runs of
  consecutive matching shingles catch verbatim and near-verbatim disclosure,
  including reformatting such as bullets, case and punctuation changes, and Unicode
  compatibility forms. A run's length and the share of a section it covers drive
  the result. Sections shorter than five tokens, such as a code word, are matched
  whole.
- **Semantic (optional).** 24-token windows with a 12-token stride are embedded
  locally. Each outbound window is compared with its nearest protected windows in
  the same application. Several close windows, or a run of consecutive very close
  ones, indicate a reordered or paraphrased dump.

The store holds keyed digests and float32 embeddings, never the protected text. An
assessment reports a disposition (`clear`, `suspicious`, `leak`), a 0–1 signal,
per-source scores and per-section evidence such as run length, coverage, distances
and outbound token ranges. Section identifiers are keyed digests, and version and
label are the host's own metadata.

Assessment sources use the names from PSP §28.4: `pattern_match` (lexical,
deterministic) and `external_classifier` (semantic, statistical). The host applies
weights, decay and thresholds. A `leak` on a SYSTEM section corresponds to the §27.4
disclosure that "SHOULD be logged and reported"; whether it becomes a hard signal is
host policy.

## Use

```ts
import { ExfiltrationStore, HashingEmbedder } from "@psp-cdl/api-server/exfiltration";

const store = new ExfiltrationStore("/var/lib/psp/exfil.sqlite", {
  key: hostKey,                      // ≥ 32 bytes from host secret storage; never model-visible
  embedder: new HashingEmbedder()    // or null for the lexical tier only
});
await store.protect({ application: "claims-intake", sectionType: "system", text: verifiedSystemText,
  version: "1.0.0", label: "claims-intake/system", expiresAt });
const assessment = await store.assess({ application: "claims-intake", text: candidateText });
```

```python
from psp_cdl_api_server.exfiltration import ExfiltrationStore, HashingEmbedder

store = ExfiltrationStore("/var/lib/psp/exfil.sqlite", host_key, embedder=HashingEmbedder())
store.protect({"application": "claims-intake", "sectionType": "system", "text": verified_system_text,
               "version": "1.0.0", "label": "claims-intake/system", "expiresAt": expires_at})
assessment = store.assess({"application": "claims-intake", "text": candidate_text})
```

Register the verified text your host signed or received, after signature checks. Do
not register the PSP interpreter instructions: they are public protocol text (§27.4)
and would match benign discussion of PSP. Register a CONTEXT payload only when it
must not appear at the checked boundary. Data the user is meant to see is not a
leak. Use `sessionId` for per-session payloads and `remove_session` /
`removeSession` when the session ends. `purge` deletes sections whose `expiresAt` has
passed. Registration is idempotent for the same application, session, type and
normalized text.

Open one store per tenant, or otherwise resolve tenancy before opening it: matching
is scoped to an application, not to a tenant. Use one connection per worker, as
with the persistence backend. The two languages read and write the same file
format.

### At the final-output boundary

The buffered loops already pass the checked candidate to the host's
`authorizeFinal` / `authorize_final` callback. Returning anything other than `true`
withholds the answer with `COMPLETION_DENIED`:

```ts
const host = {
  ...otherCallbacks,
  async authorizeFinal(principal, binding, data) {
    const a = await store.assess({ application: "claims-intake", text: data.candidate.text });
    threat.record(binding.sessionId, a);            // your §28 accumulator
    return a.disposition !== "leak" && a.complete;  // your release policy
  }
};
```

Both languages test this integration against the real `BufferedLlmLoop`. Tool
arguments and tool output pass through the host `policy` resolver at the `tool`
and `release` phases. The library does not wire the detector there, and a host that
checks them should treat its own integration as untested until it adds tests.
Streaming release remains unsupported, as everywhere in this repository.

## Vector modes

`vector: "portable"` (the default) keeps embeddings in a BLOB column and compares
them in process. It needs no native code and is reasonable for a few thousand
protected chunks per application.

`vector: {sqliteVec: path}` loads a host-approved [sqlite-vec](https://github.com/asg017/sqlite-vec)
build and maintains a `vec0` index partitioned by application, with cosine
distance. The library never chooses or downloads the extension, and the path must
come from host configuration. The repository pins sqlite-vec 0.1.9 as a development
dependency for tests:

```ts
import { getLoadablePath } from "sqlite-vec";
new ExfiltrationStore(path, { key, embedder, vector: { sqliteVec: getLoadablePath() } });
```

```python
import sqlite_vec
ExfiltrationStore(path, key, embedder=embedder, vector={"sqliteVec": sqlite_vec.loadable_path()})
```

The index is derived from the stored embeddings. A portable connection can still
read and write a store with an index: its writes mark the index stale, and the next
sqlite-vec connection rebuilds it. Some Python builds, such as macOS system Python,
cannot load extensions; that raises `VECTOR_UNAVAILABLE`, and portable mode still
works. sqlite-vec computes distances in float32, so they can differ from portable
mode in the sixth decimal place.

## Embedders

`HashingEmbedder` (`psp-exfil-hash-384-v1`) is deterministic and dependency-free.
It catches reordered and lightly edited text, not paraphrase.

`createOnnxEmbedder` / `OnnxEmbedder` run the pinned all-MiniLM-L6-v2 ONNX model
locally. Embedding through a hosted API would send the protected text to a third
party, so the adapters only read files from a host directory and refuse files whose
SHA-256 differs from the pinned digests. The host installs the runtime itself:

```sh
# Model files (Apache-2.0) at the pinned revision
REV=751bff37182d3f1213fa05d7196b954e230abad9
for f in tokenizer.json tokenizer_config.json onnx/model.onnx; do
  curl -L --create-dirs -o "models/all-MiniLM-L6-v2/$f" "https://huggingface.co/Xenova/all-MiniLM-L6-v2/resolve/$REV/$f"
done
npm install onnxruntime-node@1.30.0 @huggingface/tokenizers@0.2.0   # TypeScript host
pip install onnxruntime==1.30.0 tokenizers numpy                      # Python host
```

```ts
import * as ort from "onnxruntime-node";
import * as tokenizers from "@huggingface/tokenizers";
const embedder = await createOnnxEmbedder({ modelDir: "models/all-MiniLM-L6-v2", ort, tokenizers });
```

```python
embedder = OnnxEmbedder("models/all-MiniLM-L6-v2")
```

The two adapters produced bit-identical embeddings with ONNX Runtime 1.30.0 on the
same x86-64 machine. Other runtime versions or CPUs may differ slightly. Any other
embedder must provide `{id, dimensions, thresholds, embed(texts)}`. A store is
pinned to one embedder ID and dimension, and opening it with another raises
`EMBEDDER_MISMATCH`.

## Thresholds and calibration

Defaults are listed in the profile. The lexical tier treats a quoted rule of 16 or
more tokens, or half of a section, as a leak. It reports runs of 8–15 tokens as
`suspicious`. Distances depend on the embedder. The MiniLM defaults (0.15 / 0.30)
are starting points, not calibrated values.

One synthetic SYSTEM prompt (137 tokens) and ten hand-written outputs, assessed
with default thresholds, gave these dispositions. This is a development
observation, not an effectiveness measurement:

| Output | Lexical only | + hashing | + MiniLM |
| --- | --- | --- | --- |
| Verbatim dump | leak | leak | leak |
| One quoted rule (19 tokens) | leak | leak | leak |
| Rules as bullets | leak | leak | leak |
| Rules reordered | leak | leak | leak |
| Paraphrase of three rules | clear | clear | leak |
| One-sentence summary of the rules | clear | clear | suspicious |
| Benign on-topic answer | clear | clear | suspicious |
| Benign answer quoting premium figures | clear | clear | clear |
| Unrelated answer | clear | clear | clear |
| French translation of one rule | clear | clear | clear |

The benign on-topic answer was closer to the prompt (distance 0.16) than the
paraphrase was (0.19). What separated them was breadth: the paraphrase was close to
four protected windows, the benign answer to one. Single semantic hits are therefore
weak evidence. Calibrate `strongDistance`, `suspiciousDistance` and `leakBreadth` on
benign responses from the same workflow before using semantic results for release
decisions. The lexical `restated-instruction` vector shows the same effect: a polite
request for "the claim reference and the date of loss" repeats eight protected
tokens and is reported as a soft overlap.

## Not detected

- Translation, encodings (Base64, ciphers, spelling out letters), and other
  transformations that change the tokens.
- Summaries that stay below the thresholds, and disclosure spread across several
  turns. Each assessment sees one text; accumulate signals across turns.
- Scripts without spaces. A CJK sentence is one token, so only exact or
  whole-section matches register.
- Anything outside the checked boundary, such as an unmediated path, a stream
  released before checking, or images and audio.

## Data handling

Keep the HMAC key with other host credentials. A store opened with a different key
raises `KEY_MISMATCH` instead of silently never matching. Without the key, digests
neither reveal nor confirm protected text. Embeddings are not plaintext, but
inversion attacks can recover parts of short passages, so protect the store file
like the material it fingerprints, or use `embedder: null` for the lexical tier
only. Assessments contain no text. Their token ranges and counts still show where
matching text occurred, so handle them as security telemetry.

## Checks

`npm run check` runs the TypeScript tests, including the loop integration in
`llmproxy`. `uv run --locked python -m unittest discover -s implementations/python/tests`
runs the Python tests. Both suites run the shared vectors through portable and
sqlite-vec modes. They also check that no protected words reach the database file,
and cover idempotency, key and embedder pinning, removal and expiry, index rebuilds,
input bounds, embedder failures and the chunk limit.

`python scripts/check-exfiltration-parity.py` compares the following across
languages:

- complete assessments;
- stored rows written by each language;
- each language reading the other's store;
- a portable write followed by a sqlite-vec rebuild.

`python scripts/generate-exfiltration-vectors.py --check` verifies the vectors. Its
primitive expectations come from a separate standard-library reference.

The MiniLM tests are opt-in. Set `PSP_EXFIL_ONNX_DIR` to the model directory and
install the runtimes listed above. Without them the tests report a skip with the
reason. They are not part of CI, because the model is a 90 MB download.
