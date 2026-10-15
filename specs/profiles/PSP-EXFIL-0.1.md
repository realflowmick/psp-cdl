# PSP Exfiltration Fingerprint Profile 0.1

Status: **draft, experimental, opt-in**. License: CC0-1.0.

This implementation profile defines a host-side check of outbound text against
fingerprints of protected PSP content. It supports PSP Core 3.2.0 §27.4 (SYSTEM
content MUST NOT be disclosed, quoted or paraphrased to USER-zone actors) and the
statistical and deterministic threat sources of §28.2. It does not change the RFC,
does not decide whether an output is released, and is not evidence that any
disclosure was or was not prevented. Scores are heuristic and need calibration on
benign traffic from the workflow that uses them.

## Scope

A host registers protected **sections**: the verified text of an application
SYSTEM section, or a CONTEXT payload that must not appear at a given boundary.
The PSP interpreter instructions are public protocol text (§27.4 exceptions) and
SHOULD NOT be registered. The host then assesses outbound text, such as a final
answer, tool arguments or tool output, against every section of one application.
The result is an assessment with a disposition, per-source signals and per-section
evidence. Threat accumulation, decay, thresholds and actions remain host policy
(§28.4–28.7).

## Tokens

Text is processed as Unicode code points. A token character is any code point
whose General Category is a Letter (L*), Number (N*) or Mark (M*). Every other
code point separates tokens.

1. Split the original text into maximal runs of token characters, recording the
   code point offsets `[start, end)` of each run.
2. Apply NFKC normalization and then default Unicode lowercasing (including the
   final-sigma rule) to each run.
3. Split the result again at any non-token character, discarding empty pieces.
   Every piece keeps the offsets of its original run.

Offsets refer to the original text, never to the normalized text. Implementations
MUST NOT apply locale-specific case rules. Scripts written without spaces (for
example CJK) form one token per run; this profile does not segment them further.

## Keyed digests

Every digest is HMAC-SHA-256 under a host-owned key of 32–1024 bytes over the
UTF-8 bytes of `"PSP-EXFIL-0.1" NUL purpose NUL payload`, where NUL is U+0000:

| Purpose | Payload | Output |
| --- | --- | --- |
| `shingle` | `w` consecutive tokens joined by U+0020 | first 16 lowercase hex characters |
| `chunk` | the chunk's tokens joined by U+0020 | 64 lowercase hex characters |
| `section` | application, session ID (empty if none), section type and all tokens joined by U+0020, each separated by NUL | 64 lowercase hex characters |
| `check` | empty | 64 lowercase hex characters, stored to detect a different key |

The key is a credential. It stays outside model-visible input and outside the
store. Without the key, stored digests do not reveal or confirm protected text.

## Lexical fingerprints

For a section of `n` tokens, the shingle width is `w = min(5, n)`. Its shingles
are the keyed digests of tokens `[i, i+w)` for `i = 0 … n−w`, with position `i`.
A store keeps at most 16 positions per distinct shingle per section, the lowest
first. Outbound text is shingled at width 5 and at every width below 5 used by a
section of the application, keeping at most 16 positions per distinct digest.

Equal digests form pairs `(i, j)` of outbound position `i` and protected position
`j`. A **run** is a maximal chain `(i, j), (i+1, j+1), …` of `c` pairs. It covers
`c + w − 1` tokens: outbound tokens `[i, i+c+w−1)` and protected tokens
`[j, j+c+w−1)`. A run **qualifies** when its length is at least
`min(minRunTokens, n)`.

For each section with at least one qualifying run:

- `longestRunTokens` is the length of the longest qualifying run.
- `coverage` is the number of distinct protected token positions covered by
  qualifying runs divided by `n`.
- `ranges` are the outbound token ranges of qualifying runs, merged and sorted,
  limited to the first 32.
- The lexical disposition is `leak` when `longestRunTokens ≥ min(leakRunTokens, n)`
  or `coverage ≥ leakCoverage`, and otherwise `suspicious`.
- The lexical score is 1 for `leak`, and otherwise
  `max(longestRunTokens / min(leakRunTokens, n), coverage / leakCoverage)`.

Sections with no qualifying run have no lexical result.

## Semantic fingerprints (optional)

Chunks are token windows. For `n ≤ 24` there is one window `[0, n)`. Otherwise
windows start at `0, 12, 24, …` while `start + 24 < n`, followed by a final
window starting at `n − 24` if that start is not already present. A chunk's
ordinal is its position in this list, and its text is its tokens joined by U+0020.

An **embedder** maps chunk texts to vectors of a fixed dimension. Each vector is
stored as little-endian IEEE-754 float32 and is read back as exact float64
values. The store records the embedder identifier and dimension; fingerprints
from different embedders are never compared.

The cosine distance of float vectors `a` and `b` is `1 − a·b / (|a||b|)`, clamped
to `[0, 2]`, or 1 when either norm is zero. Dot products and squared norms are
accumulated in float64 in index order. For each outbound chunk, the `neighbors`
nearest protected chunks of the application are selected by ascending distance,
then section identifier, then ordinal. A neighbor at or below
`suspiciousDistance` is a **hit**; at or below `strongDistance` it is a **strong
hit**.

For each section with at least one hit:

- `bestDistance` is the smallest hit distance.
- `strongChunks` is the number of distinct ordinals with a strong hit, and
  `longestRun` the longest run of consecutive such ordinals.
- `suspiciousChunks` is the number of distinct ordinals with any hit.
- The semantic disposition is `leak` when there is a strong hit and either
  `longestRun ≥ min(leakChunks, chunks)` or `strongChunks / chunks ≥ leakCoverage`,
  or when `suspiciousChunks ≥ leakBreadth`. Otherwise it is `suspicious`.
- The semantic score is 1 for `leak`, and otherwise `0.25 + 0.5 × p`, where
  `p = clamp((suspiciousDistance − bestDistance) / (suspiciousDistance − strongDistance), 0, 1)`.

At most `maxChunks` outbound chunks are embedded. When there are more,
the assessment is incomplete. The lexical tier always covers the whole text.

### Defined embedders

`psp-exfil-hash-384-v1` is a deterministic feature-hashing embedder with 384
dimensions. For a chunk text split at U+0020 into words, it adds:

- for each word `t`, feature `"w" NUL t` with weight 1;
- for each three-code-point substring of `"<" t ">"`, feature `"c" NUL g` with
  weight 0.5;
- for each adjacent pair, feature `"b" NUL t₁ " " t₂` with weight 1.

Each feature's 32-bit FNV-1a hash `h` over its UTF-8 bytes selects index
`h mod 384`, and adds the weight with a negative sign when bit 31 of `h` is set.
The vector is then divided by its Euclidean norm. This embedder measures lexical
overlap that survives reordering and light edits. It does not model paraphrase.
Default distances are `strongDistance` 0.2 and `suspiciousDistance` 0.35.

`minilm-l6-v2-onnx:<first 16 hex of model SHA-256>` uses Xenova's ONNX export of
sentence-transformers all-MiniLM-L6-v2 at revision
`751bff37182d3f1213fa05d7196b954e230abad9` (Apache-2.0): `onnx/model.onnx` SHA-256
`759c3cd2b7fe7e93933ad23c4c9181b7396442a2ed746ec7c1d46192c469c46e` and
`tokenizer.json` SHA-256
`da0e79933b9ed51798a3ae27893d3c5fa4a201126cef75586296df9b4d2c62a0`. Each text is
encoded with special tokens. The tokenizer file's own padding and truncation are
ignored; sequences longer than 128 ids keep the first 127 and the final id. The
model runs with `token_type_ids` of zero. Each vector is the attention-masked
mean of `last_hidden_state`, accumulated row by row in float64, divided by its
Euclidean norm. The starting distances, `strongDistance` 0.15 and
`suspiciousDistance` 0.30, come from the design note and one synthetic
calibration. Agreement across runtimes is expected only within floating-point
tolerance.

## Assessment

A section appears in the assessment when it has a lexical or semantic result. Its
disposition is the more severe of the two (`clear` < `suspicious` < `leak`), and
its signal is the larger score. Sections are ordered by descending signal, then
section identifier.

The assessment's disposition and `signal` are the most severe and largest over
its sections, or `clear` and 0. `sources.pattern_match` is the largest lexical
score. `sources.external_classifier` is the largest semantic score, or null
without an embedder. Flags are sorted and include `system_prompt_disclosure` or
`context_disclosure` for each type with a `leak` section,
`protected_content_overlap` when any section is `suspicious`, and
`assessment_incomplete` when the chunk limit was reached.

All reported ratios and distances are rounded with `floor(x × 10⁶ + 0.5) / 10⁶`.
The assessment contains no protected or outbound text. Its token ranges and
counts still reveal where matching text occurred, so hosts handle assessments as
security telemetry.

## Thresholds

| Name | Default | Range |
| --- | --- | --- |
| `minRunTokens` | 8 | integer 1–10000, ≤ `leakRunTokens` |
| `leakRunTokens` | 16 | integer 1–10000 |
| `leakCoverage` | 0.5 | 0.01–1 |
| `leakChunks` | 2 | integer 1–10000 |
| `leakBreadth` | 3 | integer 1–10000 |
| `neighbors` | 4 | integer 1–64 |
| `maxChunks` | 512 | integer 1–100000 |
| `strongDistance`, `suspiciousDistance` | per embedder | 0–2, strong < suspicious |

## Store

A store is one SQLite database with `application_id` 0x50535045 and
`user_version` 1. It contains `exfil_meta` (profile, key check, embedder,
dimensions and optional vector-index state), `exfil_section`, `exfil_chunk` (chunk
digest and float32 embedding), and `exfil_shingle` (application, shingle digest,
section, position). It never contains protected text. Embeddings of short chunks
can be partly inverted by a capable attacker, so the store is protected like the
material it fingerprints.

`exfil_vec` is an optional sqlite-vec `vec0` index with an `application`
partition key and cosine distance. It is derived from the stored embeddings.
Writes without the extension mark it stale, and the next sqlite-vec connection
rebuilds it. sqlite-vec computes distances in float32, so its distances can
differ from the portable float64 computation in the sixth decimal place.

Registration is idempotent by section identifier and replaces the section's
version, label and expiry. Removal by section, by application session or by
expiry deletes all its rows.

## Unsupported

Translation, encoding (Base64, ciphers, spelling out), summarization below the
thresholds, cross-turn reassembly, streaming release and image or audio output
are not detected by this profile. A clear assessment is not a disclosure
guarantee. Hosts SHOULD combine this check with the §27.4 model instructions,
§28 threat accumulation and host release policy.
