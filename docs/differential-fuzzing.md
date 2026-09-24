# Bounded differential fuzzing

After `npm run build` and `uv sync --locked --all-packages`, run:

```sh
uv run --locked python scripts/differential-fuzz.py --seed 360034 --cases 512 --seconds 120
uv run --locked python scripts/differential-fuzz.py --seed 360035 --cases 4096 --seconds 600
```

The first run is part of `scripts/check-parity.py`. A scheduled/manual CI job
runs three 4,096-case seeds. Each run also executes the shared regression corpus
and 22 resource/numeric boundary cases. Runs have a case ceiling, fixed peer
executable/script, bounded batches and per-peer/whole-run deadlines. A timeout,
crash or incomplete run fails; it is never silently counted as coverage.

Python generates identical synthetic inputs for independent Python and Node
public library calls. Complete canonical strings, semantic trees, errors,
normalized tokens, actual signature bytes, envelopes and host-policy verification
decisions must agree. Accepted serialized markup/JSON and independently signed
envelopes then cross to the other implementation for decoding/verification.
Clean, expired, revoked, tampered and malformed signature cases have explicit
expected decisions, preventing agreement on a shared false acceptance.

The [shared cases](../conformance/vectors/fuzz/regressions-0.1.json) link legacy
requirement IDs to reviewed-profile rules: duplicate decoded keys, UTF-16 key
ordering, no Unicode normalization, negative zero, surrogate rejection,
unsupported negation, ASCII token whitespace, duplicate attributes and extension
preservation. Generated cases mutate quoting, delimiters, escapes, Unicode,
numbers and policy declarations. Explicit cases cross depth, attribute, token
and representation-size boundaries. The reference is the existing Codec 1.0,
Signature 2.0 and Deterministic CDL 1.0 profiles; the
[parser review proposals](../specs/reviews/PSP-CDL-REVIEW-0.1.md) are not adopted.

On disagreement, `.artifacts/fuzz-failure.json` stores the seed/index, original
input, results and a deletion-minimized source when applicable (at most 60
oracle comparisons). Reproduce using the same seed/count; inspect the minimized
case and add its reviewed expected result to the public shared corpus before
fixing either library. Signature/object failures retain their small original
case. Artifacts and logs stay out of Git. Committed cases are synthetic.

The result hash fingerprints output, not security effectiveness. Uncovered:
full workflow graph grammar, inference-engine behavior, encryption, arbitrary
schema combinators, unbounded vocabulary, all Unicode/numeric values and
independent security review. The five workflow seed vectors remain unexecuted.
Fuzz success does not close the normative review gate in #34.
