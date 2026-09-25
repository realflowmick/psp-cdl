# PSP Security Tools Profile 0.1

Status: **opt-in implementation draft; normative acceptance blocked on #35**.
CC0-1.0. This specializes PSP Core 3.2.0 Content Encryption (§17.9) and Required
MCP Tools (§22.5.2, Security Operations heading printed as §21.5.5). Neither
the RFC nor Signature 2.0/Codec 1.0 is amended. This is not RFC-PSP-API.

## Wire contract and scanning

The three POST routes `/v1/security/scan`, `/decrypt`, `/process` correspond to
`realflow.security.scan`, `.decrypt`, `.process`. Each requires its own
`security:scan`, `security:decrypt`, `security:process` scope and a fresh
host-issued `operation_id`. Decrypt takes 1–32 unique `{id, content}` sections;
scan/process take `raw_text`. Unknown options, inline keys, requesting-zone
claims and caller-provided policy are rejected. Request and response JSON each
have a 1 MiB bound; each plaintext is at most 65,536 UTF-8 bytes.

Scan uses the strict existing codec over the whole input, with at most 32
sections in preorder. Malformed markup fails the request; it is never repaired
into trusted sections. The index becomes a stable `section-N` item ID; offsets
are deliberately unsupported until byte/codepoint semantics are reviewed.
Unsigned and structurally nested sections have explicit item errors. Scan
returns verification diagnostics only, never plaintext or original content.
Untagged text is reported as present and remains untrusted. Process rejects
non-whitespace untagged root text and empty input instead of silently removing
or promoting it. Scanning does not recurse into JSON document payloads.

## Selected encryption representation

Only **encrypt-then-sign AES-256-GCM application SYSTEM/CONTEXT leaf sections**
are supported. Signature 2.0 verification of ciphertext and every protected
interpretation parameter MUST precede key resolution and decryption.

Two existing RFC representations are accepted without converting their signed
bytes: text ciphertext with protected `encrypted=true`, `encryption-algorithm`,
`encryption-key-id`, `nonce`, `tag` attributes; or signed JSON data exactly
`{encryption: {algorithm, keyId, nonce, tag}, encryptedData}`. Mixing the forms
is invalid. JSON form uses no delimiter encryption attributes. The optional
protected `decrypt` attribute selects `upfront` (omitted), `node`, or
`on-request`; all modes require an exact host-approved grant.

Nonce, tag and ciphertext use canonical padded RFC 4648 standard Base64,
including canonical pad bits; nonce is exactly 12 bytes, tag exactly 16 bytes,
key exactly 32 bytes. Additional authenticated data is empty in this draft;
the mandatory outer signature binds all interpretation and scope metadata.
Producers MUST ensure nonce uniqueness per key; this service does not encrypt.
Plaintext is strict UTF-8 text. Invalid tags, encoding or excessive plaintext
fail without releasing bytes. Cryptography uses platform/library AEAD, not a
project cipher implementation.

Sign-then-encrypt, unsigned encrypted USER sections, bootstrap protocol
encryption, non-AES algorithms, inline keys, non-text plaintext, nested signed
documents and recursive decryption are explicitly unsupported. Plaintext is
returned as data alongside transformation provenance, never as a newly signed
PSP envelope or concatenated executable prompt. Any nested markup remains
uninterpreted data requiring separate verification/authorization before use.

## Host authority, custody and release

The service resolves the same owner/operation-bound verification snapshot as
SecurityService. Context includes tenant-id, operation-id and policy-version;
unscoped keys are forbidden. Host-supplied CDL resources must permit processing.

`resolveDecryption(principal, context)` / `resolve_decryption` receives the
verified envelope digest and requested key/type/mode. It returns a host-only
grant with tenantId, subjectId, operationId, policyVersion, envelopeDigest,
keyId, algorithm, material, status, expires, requestingZone, sectionTypes,
modes and applicationOnly. All bindings must match, status must be active,
applicationOnly must be true, and the trusted requester zone must be 0–2 and
no greater than the target zone (SYSTEM 0, CONTEXT 1). No model-provided zone,
tool argument, section name or key ID establishes a grant. Hosts resolve keys
through approved local key custody; no URLs, environment lookup or key import
endpoint are exposed. Keep key bytes outside model input and responses.

`plaintextPolicy(principal, context)` / `plaintext_policy` is a decision-only
callback receiving the complete candidate output batch, including plaintext,
operation binding and transformation provenance. It must return literal
`allow: true`, `complete: true` and a nonempty list of fresh, operation- and
recipient-bound CDL resource evaluations covering every originating restriction
and plaintext location. The deterministic CDL evaluator must allow all of them.
The service performs no persistence, audit logging or provider/tool dispatch.
Hosts must enforce no-log/no-persist on callbacks, telemetry and any later use;
successful decryption grants no permission to persist or dispatch plaintext.

Identity, operation expiry/revision, signature authority and decryption grants
are rechecked before buffered release. Hosts MUST serialize authoritative policy
changes with service use, or revoke the operation/change its policyVersion when
encryption grants change. Callback deadlines, request quotas and memory custody
belong to the host. The API does not promise atomicity against an independently
changing identity/key service or reliable zeroization of runtime strings.

Decrypt reports independent per-item success/error, with plaintext only for
items admitted by batch release policy. Process composes scan, verification,
optional decryption and release. If any item fails, **all content is suppressed**;
successful candidates are marked `BATCH_REJECTED`. Empty/invalid results are not
passes. HTTP 200/MCP isError=false means processing completed; callers must
inspect `success`, each item and the summary. Results are not dispatch permits.

## Open normative decisions

PSP-E006/#35 still blocks normative API adoption. RFC examples permit optional
verification and mixed raw-text rebuilding; this draft always verifies and
never emits executable rebuilt markup. Required-tool names are draft counterparts
only. Review remains needed for sign-then-encrypt authenticated routing/AAD,
USER encryption without signed USER authority, binary/JSON plaintext types,
offsets, recursive signed children, decryption-mode orchestration and bootstrap
classification. Unsupported cases remain visible until separately reviewed.
