# Reusable library API

For durable workflow state, see the [persistence API and storage options](persistence.md). Its replaceable store uses these core JSON codecs and leaves parsing independent of database I/O.

For authenticated HTTP/MCP session and checkpoint operations, see the [workflow API](workflow-api.md) and [runnable examples](../examples/workflow/README.md). Hosts own authentication, transition approval, policy revisions and data-release views.

The experimental TypeScript and Python packages implement the same [codec profile](../specs/profiles/PSP-CODEC-1.0.md), [signature profile](../specs/profiles/PSP-SIGNATURE-2.0.md) and [finite CDL profile](../specs/profiles/CDL-DETERMINISTIC-1.0.md). Their runtime does not read this repository or call a service. Use them directly from proxies, MCP servers, applications or model integration tooling. They do not implement an inference engine or workflow executor.

## Document round trips

```ts
import { parseMarkup, serializeMarkup, documentToJson, documentFromJson }
  from "@psp-cdl/core";

const source = '${psp type=application name="demo"}\r\n${psp type=context}Hello 🧪${/psp}\r\n${/psp}';
const document = parseMarkup(source);
const restored = documentFromJson(documentToJson(document));
console.assert(serializeMarkup(restored) === source);
const canonicalMarkup = serializeMarkup(restored, "canonical");
```

```python
from psp_cdl_core import (
    parse_markup, serialize_markup, document_to_json, document_from_json,
)

source = '${psp type=application name="demo"}\r\n${psp type=context}Hello 🧪${/psp}\r\n${/psp}'
document = parse_markup(source)
restored = document_from_json(document_to_json(document))
assert serialize_markup(restored) == source
canonical_markup = serialize_markup(restored, "canonical")
```

Objects are ordinary validated language values: TypeScript interfaces or Python typed dictionaries, with `kind`, `profile`, `children`, section `attributes`, and text `value`. `documentFromObject` / `document_from_object` validates and detaches values; `documentToObject` / `document_to_object` optionally removes the original source hint. Adjacent text is normalized. The corresponding `*Json` functions use bounded, duplicate-aware parsing and JCS serialization.

Preserve mode returns exact original markup only if its reparsed tree still matches. After editing children or attributes, it emits the edited semantic tree canonically. Canonical mode always does so. Limits apply to each representation; escaping or retaining both tree and source may exceed a later representation's budget and raises an error. Error objects expose `code` and, for relevant syntax errors, a UTF-8 byte `offset`.

## Signatures and authority

Import Node crypto from `@psp-cdl/core/crypto`; import Python crypto from `psp_cdl_core.crypto`. Signing accepts caller-supplied Ed25519 32-byte private seeds or HMAC keys of at least 32 bytes. Verification accepts Ed25519 32-byte public keys or HMAC keys. No key is discovered from an untrusted URL. Keep keys outside model input and use a suitable secret store in the host.

| TypeScript | Python | Contract |
| --- | --- | --- |
| `signEnvelope` | `sign_envelope` | Sign text/JSON data with explicit metadata |
| `signDocument` | `sign_document` | Sign the entire nested document as JSON |
| `verifySignature` | `verify_signature` | Cryptographic validity only; insufficient for trusted use |
| `verifyEnvelope` | `verify_envelope` | Validate signature, time, active scoped key authority and accepted attributes |
| `signatureInput` | `signature_input` | Exact protected three-field bytes |
| `parseEnvelope`, `serializeEnvelope` | `parse_envelope`, `serialize_envelope` | Strict envelope JSON, including explicit alias emission |
| `envelopeToSection`, `sectionToEnvelope` | `envelope_to_section`, `section_to_envelope` | Lossless protected-content mapping for leaf sections |
| `envelopeToDocument` | `envelope_to_document` | Restore a signed JSON document tree after verification |

`verifyEnvelope` / `verify_envelope` requires host-owned `keys`, `now`, `context`, `allowedAttributes`, and optional `clockSkew`. Every key record specifies `id`, `algorithm`, `material`, `status`, `trustLevels`, `sectionTypes`, `scope`, and `allowUnscoped`. Signed context attributes must match the host context; omissions need explicit unscoped permission. Duplicate/unknown/revoked keys, unauthorized trust levels, unsupported attributes and scope mismatches fail. Expiration is strict at `now >= expires`; skew only tolerates a future timestamp. The returned envelope does not authorize a tool operation or establish that its content is truthful.

Whole-document interchange follows `signDocument → envelopeToSection → serializeMarkup → parseMarkup → sectionToEnvelope → verifyEnvelope → envelopeToDocument`. The equivalent Python functions use snake case. A nested section cannot be flattened directly into a leaf envelope. Signature normalization can change text line endings and surrounding ASCII whitespace in protected bytes as specified by the signature profile; markup trees themselves retain original text.

## CDL transport and evaluation

```ts
import { parseDeclarations, withDeclarations, parseCdlJson, serializeCdlJson }
  from "@psp-cdl/cdl";
const schema = { type: "string", "x-cdl-classes": "PII", "x-cdl-covenants": "no-training" };
const declarations = parseDeclarations(schema);
const encoded = serializeCdlJson(withDeclarations(schema, declarations, "array"));
const restoredSchema = parseCdlJson(encoded);
```

```python
from psp_cdl_cdl import parse_declarations, with_declarations, parse_cdl_json, serialize_cdl_json
schema = {"type": "string", "x-cdl-classes": "PII", "x-cdl-covenants": "no-training"}
declarations = parse_declarations(schema)
encoded = serialize_cdl_json(with_declarations(schema, declarations, "array"))
restored_schema = parse_cdl_json(encoded)
```

The string and array declaration formats normalize to the same tokens. JSON transport preserves all fields without claiming that every annotation is supported. `resolveSchemaPolicy` / `resolve_schema_policy` resolves **one data JSON Pointer** through `properties` and homogeneous `items`; it is not JSON Schema validation or whole-object classification. Hosts must validate their data separately, resolve every contributing location, and reject unsupported schema features.

`inheritPolicy` / `inherit_policy` consumes a trusted root-to-leaf declaration path and scoped grants. It returns effective classes/covenants plus `origins` and `basisGroups`. `evaluateResolvedPolicy` / `evaluate_resolved_policy` accepts that state, facts keyed by each origin ID, and class facts. It evaluates origins separately so a child's legal basis or role parameters cannot waive a parent's restriction. Missing origin facts deny. Do not flatten the returned covenant set into one `evaluatePolicy` call.

`aggregateCapabilities` / `aggregate_capabilities` requires a complete authenticated inventory and computes its union with directed implications. `evaluatePolicy` / `evaluate_policy` evaluates a single originating declaration unit; `evaluateBatch` / `evaluate_batch` combines units conjunctively. Facts contain `capabilities`, `checks`, `parameters`, and `context` as defined by the [fixture interface](../conformance/policy/README.md). These values must come from host authorities and operation-bound evidence, never directly from model/tool claims. `checkEnforcement` / `check_enforcement` checks declared installed gates; it cannot prove that middleware actually intercepted an operation.

## Verification and packaging

Run `npm run conformance:profiles` or `python -m psp_cdl_test_harness --profiles` after the development setup. These run 511 shared library checks: 315 policy/trust, 143 codec and 53 signature checks. Additional library unit tests cover scope, authority, edited-source behavior, schema paths and per-origin restrictions. `python scripts/check-parity.py` compares the complete reports and exchanges 93 documents and four independently signed envelopes between languages in both directions.

`python scripts/check-packages.py` builds and installs local npm tarballs and Python wheels in ignored isolated consumer directories, then runs parsing, cryptographic and policy smoke checks without editable source imports. It requires Node/npm and uv on PATH, after installing the workspace dependencies. Nothing is published. TypeScript packages remain private and all versions are provisional. Downstream projects can install these local artifacts until a reviewed release.

Authenticated HTTP/MCP security, opt-in workflow adapters and MCPProxy consume these libraries; see the [service guide](service-api.md), [workflow API](workflow-api.md), [MCP dispatch guide](mcp-dispatch.md) and [stdio mediation guide](mcp-stdio.md). `McpDispatchGate` checks exact active-node affinity, registered capability unions, input/output schemas and CDL at dispatch and release. `OwnerCoordinator` is required when attaching a store to this single-process gate. The explicit `@psp-cdl/mcpproxy/mcp` / `psp_cdl_mcpproxy.mcp` module adds `StdioMcpClient`, `createMcpProxy` / `create_mcp_proxy` and `serveStdio` / `serve_stdio` for bounded local mediation. The same module adds `HttpMcpClient`, `McpHttpServer` and gate-backed tool-service factories for [authenticated Streamable HTTP](mcp-http.md). Full RFC MUST coverage, remaining M3 tools, OAuth client flows, the model loop, inference-engine attention isolation and measured attack resistance remain later work. A profile result is scoped library evidence, not full protocol certification.

The optional [revision profile and refresh API](mcp-revision.md) adds `RevisionedToolRegistry` in the explicit MCP server revision module, `revisionProfile` connection configuration, detached catalog snapshots and approved gate replacement. It uses the same APIs in both transports; existing clients retain their legacy discovery contract unless opted in. See the [paired refresh examples](../examples/revision/README.md).
