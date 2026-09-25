# Opt-in scan, decrypt and process services

`SecurityToolsService` is available from `@psp-cdl/api-server/security-tools`
and `psp_cdl_api_server.security_tools`. It uses the existing authenticated
HTTP and MCP adapters. The default SecurityService still exposes only verify
and policy evaluation. The [versioned draft](../specs/profiles/PSP-SECURITY-TOOLS-0.1.md)
defines supported encryption, ordering, key custody and release requirements.

| Operation | Request | Behavior |
| --- | --- | --- |
| scan | operation_id, raw_text | Strict parsing and bounded per-section signature diagnostics; no content returned |
| decrypt | operation_id, sections of id/content | Verify ciphertext, resolve a host-approved key/zone, decrypt and authorize buffered plaintext |
| process | operation_id, raw_text | Scan, verify and optionally decrypt; suppress every content field if any item fails |

Routes are `/v1/security/scan`, `/v1/security/decrypt`,
`/v1/security/process`; MCP names are `realflow.security.scan/decrypt/process`.
Each has a corresponding `security:` scope. Input/output schemas are in the
[OpenAPI contract](../schemas/api/security-tools-0.1.openapi.json) and
[MCP contract](../schemas/mcp/security-tools-extension-0.1.json).

Supply the normal authenticate/resolve/now host, plus:

- `resolveDecryption` / `resolve_decryption`: authorize the exact verified
  envelope digest and operation, then return a host-only AES key grant. The
  grant binds owner, tenant, policy, key, type, mode, expiry and requester zone.
- `plaintextPolicy` / `plaintext_policy`: approve the complete candidate
  plaintext batch and return complete CDL resources for the intended recipient.
  The shared deterministic evaluator must allow every resource. This callback
  must not log or persist prohibited plaintext or perform downstream effects.

```ts
const service = new SecurityToolsService(securityToolsHost, lifecycleService);
const http = createHttpServer(service);
const mcp = new McpServer(service, () => launcherCredential);
```

```python
service = SecurityToolsService(security_tools_host, lifecycle_service)
application = create_wsgi_app(service)
mcp = McpServer(service, lambda: launcher_credential)
```

The optional second argument composes a WorkflowService or LifecycleService;
both authorities must authenticate the same principal and grant the operation's
scope. Discovery remains scope filtered. With lifecycle enabled, all eleven RFC tool names have draft
counterparts, alongside policy evaluation and the cancel/purge extensions.
This is scoped implementation coverage, not full RFC conformance.

Only signed encrypt-then-sign AES-256-GCM application SYSTEM/CONTEXT leaf
sections are decrypted. Both protected delimiter attributes and the RFC signed
JSON-data representation have shared fixtures. Nonce/tag encodings are strict;
inline keys, unsigned/sign-then-encrypt containers, USER encryption, bootstrap
encryption, other algorithms and non-text plaintext are unsupported. The result
includes verified ciphertext provenance; it does not claim the original
signature signs a newly produced plaintext envelope. Nested plaintext remains
data and must not be reparsed as authority without separate checks.

Requests/responses are at most 1 MiB, batches/scans at most 32 sections and each
plaintext at most 65,536 UTF-8 bytes. Missing facts, expired/revoked grants,
forbidden zones and incomplete release coverage fail closed. No listener,
credential discovery, logging, storage or provider execution starts on import.
Hosts provide callback deadlines, quotas and coordination for policy changes.

The implementation uses [Node's authenticated decipher API](https://nodejs.org/api/crypto.html#deciphersetauthtagbuffer-encoding)
and Python's [AESGCM implementation](https://cryptography.io/en/latest/hazmat/primitives/aead/#cryptography.hazmat.primitives.ciphers.aead.AESGCM).
Authenticated-decryption failure withholds all candidate bytes. The libraries
do not promise zeroization of runtime strings or secure host key storage.

Run the repository suites plus `scripts/check-security-tools-parity.py`.
62 shared cases cover clean/malformed content, key/signature revocation,
ownership, zones, mixed outcomes, release denial, callback detachment and
resource bounds. Real HTTP/MCP stdio checks exercise all eleven draft names in
both language directions; actual ciphertext/signature output is exchanged both
ways. Contract/vector generators have `--check` modes and run in CI.

Normative API adoption remains pending #35. The draft's open decisions include
sign-then-encrypt routing/AAD, encrypted USER content, plaintext types, offsets,
recursive signed documents and bootstrap classification. M3, the full workflow
harness and independent review remain open.
