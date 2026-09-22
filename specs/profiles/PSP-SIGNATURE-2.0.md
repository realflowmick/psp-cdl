# PSP Signature Profile 2.0

**Status:** Proposed Standard; author-directed resolution for PSP Core 3.2.0.

**Date:** September 22, 2026

**License:** CC0-1.0

This normative profile resolves PSP-E001 through PSP-E004. It retains exactly three signature-input fields. The first field represents the complete protected section, including metadata; it is not only the text between delimiters. A valid signature authenticates a declaration. Authorization still comes from the verifier's trusted key and scope policy.

## 1. The three-field input

```text
canonical_content = JCS({"data": normalized_data, "metadata": protected_metadata})
signature_input = UTF8(canonical_content + "|" + decimal(timestamp) + "|" + canonical_version)
```

`JCS` means RFC 8785 without alternatives or additional Unicode normalization. No byte-order mark or trailing newline is added. The separators are the single ASCII byte `0x7c`. Timestamp and version MUST NOT contain that character; pipes within content are ordinary data. The final two separators therefore delimit the final two fields unambiguously. Implementations MUST construct the input from parsed fields rather than split untrusted content on every pipe.

`timestamp` is an integer Unix time in seconds in `[0, 9007199254740991]`. Its signed representation is unsigned base-10 without leading zeroes, except `0` itself. JSON transports MUST use an integer value; delimiter transport MUST use the canonical decimal spelling, without a sign or exponent. Booleans are not integers for this purpose.

`version` is a SemVer 2.0.0 content version. A single optional lowercase `v` prefix is removed before signing and comparison; every remaining character, including prerelease and build metadata, is preserved. Leading zeroes in numeric version components are rejected. Signature-format selection uses `signatureVersion`, not the content version.

Implementations MUST NOT append trust level, priority, expiration, or authority as additional signature-input fields. Those controls are bound through `protected_metadata` inside the first field and through trusted key authorization.

## 2. Protected content and metadata

The JSON wire representation remains `{ "signature": { ... }, "data": ... }`. The signature object has the following fields:

| Field | Requirement | Included in protected metadata? |
| --- | --- | --- |
| `value` | Required on signed messages; canonical unpadded base64url | No: this is the signature output |
| `timestamp` | Required integer Unix seconds | No: second signed field |
| `version` | Required content version | No: third signed field |
| `signatureVersion` | Required, exactly `"2.0"` | Yes |
| `algorithm` | Required, `"ed25519"` or `"hmac-sha256"` | Yes |
| `kid` | Required nonempty string for Ed25519; absent for HMAC | Yes when present |
| `secretId` | Required nonempty string for HMAC; absent for Ed25519 | Yes when present |
| `sectionType` | Required lowercase PSP section type | Yes |
| `contentType` | Required, `"text"` or `"json"` | Yes |
| `expires` | Required integer Unix seconds, strictly greater than `timestamp` | Yes |
| `trustLevel` | Integer 0–5; missing means 2 | Yes, after expanding the default |
| `priority` | Finite number 0–100; missing means 50 | Yes, after expanding the default |
| `attributes` | Object of additional section attribute names to string values; missing means `{}` | Yes, including every entry |

Construct `protected_metadata` by copying every signature-object member except `value`, `timestamp`, and `version`, then expanding the three defaults above. Unknown signature-object members, null substitutes, duplicate property/attribute names, and conflicting aliases MUST be rejected. Additional section controls belong in `attributes`, not in unprotected root members. Keys in `attributes` MUST NOT duplicate any reserved delimiter or JSON signature field in this profile. All other attribute names and their decoded string values are preserved exactly, without case, whitespace, URI, or Unicode normalization. An unsupported critical control MUST be rejected rather than silently claimed as enforced.

The envelope has exactly either `signature` and `data`, or `x-signature` and `x-data`. The two matched alias pairs map to the same internal representation. Mixed pairs, duplicate aliases, and additional envelope-root members MUST be rejected. Application data or controls must be placed within the signed data or protected attributes. Duplicate JSON names MUST be detected before a parser can discard them.

For `contentType="text"`, `data` is a string. Replace CRLF and remaining CR with LF, then trim only U+0009 (tab), U+000A (LF), and U+0020 (space) from both ends. Preserve internal whitespace and all other Unicode characters. These are the only text normalization operations.

For `contentType="json"`, `data` is an object or array. Do not trim or otherwise modify its string values. JCS determines property ordering, escaping, number serialization, and UTF-8 output for the entire protected-content object. Reject duplicate names, invalid Unicode including lone surrogates, and non-finite numbers. Integer data outside the interoperable safe-integer range MUST be represented as strings; readers must reject out-of-range integer values before lossy conversion. Applications needing more numeric precision than binary64 MUST use strings. Do not apply NFC or any other Unicode normalization during signing or verification.

Two different Unicode sequences remain different signed values even if they render identically. Normalization required by an application must happen before the signed document is created and is then part of its content.

### 2.1 Delimiter mapping

| PSP delimiter attribute | Signature-object field |
| --- | --- |
| `signature` | `value` |
| `signature-algorithm` | `algorithm` |
| `signature-version` | `signatureVersion` |
| `kid` | `kid` |
| `secret-id` | `secretId` |
| `timestamp` | `timestamp` |
| `version` | `version` |
| `expires` | `expires` |
| `trust-level` | `trustLevel` |
| `priority` | `priority` |
| `type` | `sectionType` |
| `content-type` | `contentType` |
| Every other opening-tag attribute | Same name in `attributes`, with its parsed string value |
| Body between matching tags | `data` |

Delimiter signed messages MUST include `signature-version="2.0"` and `content-type`. Known numeric attributes are parsed with their defined numeric types; priority uses JSON number grammar and a finite value in range. Integers reject noncanonical spellings. Section type and algorithm use their registered lowercase spellings. Arbitrary lowercasing of extension attributes is forbidden. Parse escaped attribute values before mapping. A JSON body is parsed only when `content-type="json"`; it is never guessed from its appearance. Reordered opening-tag attributes therefore produce the same protected content, and changes to their effective values change the signature input.

### 2.2 Trust, authority, and scope

Trust level, priority, section type, expiration, and key selection are already contained in the protected section. A change to an effective protected value changes the signed bytes. Expanding an omitted default to its explicit equivalent is not a change of meaning and produces the same bytes.

The verified `kid` (or `secretId`) identifies an authority only through the verifier's trusted registry. The registry MUST bind key material to allowed algorithm, current key status, permitted trust levels, section types, and application/tenant scope. The verifier MUST reject unknown or revoked keys and unauthorized declarations even when the mathematical signature verifies. An attacker-supplied key or authority string cannot create authority. HMAC authenticates membership in the secret-sharing group and does not identify an individual signer.

Where a signature is scoped to a node, session, tenant, recipient, or use, encode that scope in signed data or protected attributes and compare it against independently authenticated execution context. Unscoped reusable documents are permitted only where the trusted key policy permits reuse. Signatures and expiration alone do not provide single-use replay protection; checkpoint tokens and similar operations need nonce/consumption state. Do not trust a model's asserted scope or authorization.

## 3. Encoding and algorithms

The base profile requires Ed25519 support and permits HMAC-SHA256. Sign or MAC exactly `signature_input`; do not add a separate application prehash. The result is unpadded base64url per RFC 4648 section 5, with no whitespace, `+`, `/`, or `=`. A decoder MUST enforce canonical round-trip encoding, zero unused pad bits, and the algorithm's decoded output length (64 bytes for Ed25519; 32 for HMAC-SHA256). Hexadecimal and standard/padded Base64 belong to legacy formats and are rejected by this profile. HMAC comparison MUST be constant-time.

Other algorithms require a separately specified, explicitly selected signature profile defining their precise parameters and encoding. Implementations MUST NOT infer the algorithm from a key or signature length or fall back to another algorithm on failure. Registry policy and protected metadata must agree.

## 4. Expiration and time

Every signed message MUST contain authenticated `timestamp` and `expires` values, with `expires > timestamp`. Missing, malformed, out-of-range, or inverted values are invalid. No default expiration, infinite expiration, or unsigned expiration override is allowed.

After metadata, key policy, and signature verification, temporal acceptance is:

```text
timestamp - configured_clock_skew <= now < expires
```

All times use Unix seconds. `now` may retain subsecond precision; it MUST NOT be rounded down to extend validity. The default clock skew is zero; a trusted verifier configuration MAY permit up to 300 seconds solely for a slightly future `timestamp`. Never extend expiration. At `now == expires`, the signature is expired. A deployment MAY impose a shorter maximum lifetime or other stricter policy.

Temporal rejection reason precedence is: invalid interval/metadata, then expired (`now >= expires`), then not yet valid (`now < timestamp - skew`). Signature/authentication failures are never represented as successful temporal validation. Full implementations may reject malformed or obviously expired input early, but MUST NOT use any unauthenticated field to grant authority.

`refresh-grace` is a **pre-expiration refresh lead time**. It initiates retrieval while the current signature is still valid. It does not permit execution after expiration. If fresh authorized content cannot be obtained before expiration, protected execution MUST pause or fail closed. Previously expired signatures MAY be verified for forensic/audit purposes, but the result must report them as expired and MUST NOT authorize execution. Historical public-key retention is independent of execution validity.

Refreshing a signature requires the signing authority to generate a new timestamp, protected expiration and signature for the selected content version. Clients MUST NOT extend the expiration themselves.

## 5. Verification and processing order

1. Strictly parse the envelope or delimiter section and reject duplicate/conflicting fields, unsupported profile identifiers, invalid encodings, or invalid field types/ranges.
2. Resolve a trusted key record in authenticated application/tenant context and enforce algorithm/key-status policy; never use an untrusted registry endpoint from the document.
3. Normalize data, expand metadata defaults, and reconstruct the exact three-field input.
4. Verify Ed25519 or HMAC-SHA256. No alternate formula or format fallback is permitted.
5. Enforce the time interval, key authority, signed scope, and independently configured policy before using any claimed trust level, priority, directives, or data.
6. Verify nested signatures independently. A parent signature covers nested envelopes as data, including their signature values and metadata; it does not replace child authorization or expiration checks.

For sign-then-encrypt, encrypt the complete signed envelope and verify that recovered envelope before use; outer routing hints are untrusted. For encrypt-then-sign, the ciphertext and all encryption parameters that affect its interpretation must be inside the signed data/protected attributes. Do not add operative attributes after signing. Each mode must preserve the same complete protected-content boundary.

## 6. Compatibility and migration

`signatureVersion="2.0"` is mandatory and itself protected. Absent, `"1.0"`, unknown, and downgraded identifiers MUST NOT be accepted by this profile. Existing signatures made over raw body-only content or five-field concatenation are not wire compatible with this clarification. Reissue them through a trusted signing authority using the complete protected section and the three-field formula. Do not try multiple formulas until one verifies.

An explicitly configured legacy reader may be maintained for migration/audit, but cannot claim profile-2.0 verification or silently upgrade a legacy document's authority. Producers and consumers must negotiate supported profiles through authenticated configuration; failures return unsupported-profile errors, not permissive fallback. Document-version 3.1.1 remains archived; PSP Core 3.2.0 selects this profile.

The accompanying [vectors](../../conformance/vectors/signatures/profile-2.0.json) include exact canonical content, input bytes, deterministic signatures with public test keys, metadata mutation checks, text/default normalization, Unicode/number cases, and expiration boundaries. The vector checks validate this specification fixture set, not complete PSP service conformance.

Normative references: [RFC 8785](https://www.rfc-editor.org/rfc/rfc8785.html), [RFC 4648](https://www.rfc-editor.org/rfc/rfc4648.html), [SemVer 2.0.0](https://semver.org/spec/v2.0.0.html).
