# PSP API 1.0.0 — Candidate 1

Document: RFC-PSP-API-1.0.0-candidate.1. Status: **candidate for public review;
not adopted**. License: CC0-1.0. Issue: #35. The
[adoption record](adoption-1.0.0.json) records publication, comment deadlines and
the separate maintainer decision. Publication or passing tests cannot adopt it.

## 1. Motivation and scope

PSP Core 3.2.0 Scope names an unavailable RFC-PSP-API. Its Required MCP Tools
section (§22.5.2) requires eleven tool names but leaves illustrative wire
examples, authority boundaries and error behavior insufficiently specified.
This candidate proposes a **new, separately versioned normative API**, rather
than deleting that reference or declaring that an API existed historically.

The candidate specifies bounded authenticated session, node, checkpoint and
security operations. It selects existing experimental wire contracts and adds
their compatibility and adoption decisions in one document. It does not specify
inference, tool dispatch, SaaS endpoints, identity issuance or a public ingress.
Host authority and policy enforcement remain mandatory integration obligations.

The words MUST, MUST NOT, SHOULD and MAY express proposed requirements within
this candidate. Stable identifiers below belong to this API only; existing core
requirement IDs and their blocked/unimplemented dispositions are unchanged.

## 2. Contract set and selection

**API1-CONTRACT-001.** Implementations selecting API 1.0.0 MUST implement the
eleven required operations in the [contract index](contract-set-1.0.0.json).
Each claimed transport (HTTP, MCP stdio, or both) MUST expose all eleven;
operation or transport subsets must be described as partial implementations.
The [OpenAPI bundle](../../schemas/api/psp-api-1.0.0-candidate.openapi.json) and
[MCP catalog](../../schemas/mcp/psp-api-1.0.0-candidate.json) specify exact field
names, required fields, limits and result shapes. The index pins source
contracts and referenced profiles by SHA-256 over UTF-8 text with LF line endings.
Changes to a pinned source require a new candidate and renewed compatibility
review; they cannot silently change this contract set.

**API1-CONTRACT-002.** Selection MUST be explicit in host/client configuration.
The `/v1` route prefix alone does not select this candidate or prove conformance.
There is no new negotiation header or discovery capability. Existing response
`profile` values (`PSP-SERVICE-0.1`, `PSP-WORKFLOW-SERVICE-0.1`,
`PSP-LIFECYCLE-0.1`, `PSP-SECURITY-TOOLS-0.1`) remain exact wire identifiers;
the API document version and those module identifiers are separate version axes.
Clients MUST NOT replace them with `1.0.0` or infer adoption from their presence.

Technical clauses of the pinned Service, Workflow, Lifecycle and Security Tools
profiles apply to their operations, with the explicit choices in this document
taking precedence for API 1.0.0 adopters. Individual module statements about
unimplemented operations describe that module alone, not this composed API.
Profile status paragraphs do not acquire a new status through this reference.
Persistence requirements apply to observable ownership, expiry, atomicity,
receipts and recovery semantics; SQLite's file layout is not an API requirement.
Signature 2.0, Codec 1.0, CDL Deterministic 1.0 and Trust 1.0 supply their selected
technical rules. No other draft, commercial service or implementation code is
an implicit normative reference. A conflict without an explicit disposition
remains blocked and MUST NOT be resolved by weakening a security requirement.

## 3. Required operations

Every HTTP route below is POST under `/v1/`. The MCP name is `realflow.` followed
by the route with `/` replaced by `.`. All listed request fields are required.
The referenced schemas define their types and bounds; unknown fields fail.

| Route | Request fields | Scope |
| --- | --- | --- |
| sessions/create | requestId, nodeId, nodeVersion, expiresAt, state | sessions:write |
| sessions/get | sessionId | sessions:read |
| sessions/update | requestId, sessionId, expectedVersion, nodeId, nodeVersion, status, state | sessions:write |
| sessions/list | after, limit, status | sessions:read |
| nodes/fetch | nodeId, nodeVersion | nodes:read |
| checkpoints/create | requestId, sessionId, expectedVersion, expiresAt | checkpoints:write |
| checkpoints/resume | requestId, checkpointId, state | checkpoints:resume |
| security/verify | operation_id, sections | security:verify |
| security/decrypt | operation_id, sections | security:decrypt |
| security/scan | operation_id, raw_text | security:scan |
| security/process | operation_id, raw_text | security:process |

**API1-EXTENSION-001.** `policy/evaluate`, `sessions/cancel` and `sessions/purge`
are optional extensions in the bundle. They MUST NOT count toward the eleven.
If enabled, their pinned contracts and independent scopes apply. Disabled
extensions MUST NOT be advertised or executed. `realflow.security.refresh` is
a separate host-control profile and is outside this catalog. Supporting fewer
than eleven required operations is a partial implementation, even when every
implemented operation passes its own tests.

## 4. Authority, wire transport and errors

**API1-AUTH-001.** A trusted host MUST validate credentials, derive tenant,
subject and scopes, and authorize each operation and released view. Caller
identifiers, application state, metadata, `_meta`, cursors and proposed approval
fields MUST NOT establish authority. Ownership and operation bindings MUST be
checked independently of a resolver returning a record. Denied and unknown
ownership lookups MUST NOT disclose another owner's record. Composed services
MUST agree on identity and independently grant the operation's scope.

**API1-AUTH-002.** Security operations MUST resolve a fresh owner-bound
`operation_id`, policy revision and expiration, with trusted verification keys
and complete CDL resource facts. Expiry rejects at equality. The signature
context MUST bind tenant-id, operation-id and policy-version; unscoped signing
keys are forbidden. Keys, clocks, policy evidence, resume credentials and
authoritative session state MUST remain outside model-visible inputs. Hosts
MUST coordinate external authority changes as required by the selected profiles;
database atomicity does not provide atomic cross-system revocation.

**API1-TRANSPORT-001.** HTTP uses host-validated Bearer credentials, JSON,
`Cache-Control: no-store`, exact route/method handling and the Service 0.1
transport restrictions. Duplicate keys/headers, malformed UTF-8, compressed or
oversized bodies and unsupported media types MUST fail. Request/response bodies
are bounded to 1 MiB. Remote exposure requires trusted TLS/authentication ingress;
the loopback helpers are not a deployment specification. WSGI hosts MUST supply
framing, connection and timeout enforcement that the application cannot recover.

**API1-TRANSPORT-002.** MCP uses the Service 0.1 pinned protocol version
2025-11-25 and bounded UTF-8 newline-delimited stdio. Identity is pinned during
initialization, discovery is filtered by current scope, and invocation checks
authorization again. Notifications MUST NOT invoke tools or receive responses.
Unsupported methods/capabilities MUST remain explicit. The bundle does not
standardize a Streamable HTTP MCP server, OAuth issuance, subscriptions or tasks.

**API1-ERROR-001.** HTTP request failures use `{error:{code}}`; MCP protocol
errors and tool execution errors follow the pinned Service contract. Generic
internal failures MUST NOT expose exception text, keys or credentials. Clients
MUST distinguish transport completion from per-item success: HTTP 200 and MCP
`isError: false` do not mean every signature, decryption or policy check passed.
Unknown error codes MUST be treated as failures, not permission to continue.

| HTTP status | Meaning and representative codes |
| --- | --- |
| 400 | Invalid input/command or unsupported untagged processing |
| 401 | Missing or invalid credential |
| 403 | Scope, authorization, persistence, retention or policy denial |
| 404 / 405 | Missing route/record/operation or unsupported method |
| 409 | Stale operation, expired state, version/idempotency conflict, consumed checkpoint or retired receipt |
| 413 / 415 | Size/section bound or unsupported media type |
| 500 | Internal/configuration failure or oversized response |
| 503 | Store busy or private checkpoint delivery failure |

Per-item signature and decryption failures remain in the documented result
shape, even when HTTP succeeds. The numeric `PSP_SEC_001` example family is not
an alias for this API's code strings; clients must explicitly migrate.

## 5. Workflow and retention requirements

**API1-STATE-001.** Session IDs MUST be server-generated UUID v4 identifiers;
node definitions are published by the trusted host. Reads release host-projected
views, never unrestricted control records. State and transition requests are
untrusted proposals. Authorization, policy approval, expected revision, writes
and receipts MUST follow the Workflow/Persistence atomic commit contract.

**API1-RETRY-001.** Mutations MUST use owner-scoped request IDs. Identical retries
recover historical acknowledgements after fresh authorization; changed commands
or relevant policy bindings fail with `IDEMPOTENCY_CONFLICT`. A recovered receipt
MUST NOT authorize a new transition. Projection or private token delivery can
fail after commit; clients MUST retain the original request ID for recovery and
read live state before subsequent decisions. This is not exactly-once external
execution or guaranteed notification delivery.

**API1-CHECKPOINT-001.** Creation MUST bind checkpoint, session revision and
expiry, then privately hand the resume token to the host. Neither token nor
token-bearing resume link may appear in HTTP/MCP inputs or outputs. Resumption
MUST retrieve the token through trusted host custody and independently authorize
the transition. Ownership, strict expiry, single-use consumption and atomic
receipt rules apply. Notification delivery and delegated approvers are unsupported.

**API1-LIST-001.** Listing MUST partition by recovery epoch, tenant and owner,
authorize every returned row, and expose only the metadata in its schema.
Pagination uses an exclusive UUID cursor with a 1–50 limit. Expired means
`now >= expiresAt`; other named statuses exclude expired rows, `all` includes
them, and purged rows are excluded. A page is a live bounded view, not a stable
snapshot across calls or a total count.

**API1-RETENTION-001.** Enabled cancellation/purge extensions MUST enforce the
Lifecycle state machine, invalidate old operation/checkpoint use, and retain
only policy-approved replay metadata. Purge removes at most one related child
payload per transaction in addition to the session payload. The first page hides
all session payload access. Conflicts with no-persist/no-log or deletion duties
MUST deny the operation; tombstones and hashes are not exempt. Logical removal
MUST NOT be described as physical erasure. Epoch retirement, node deletion,
backup erasure and distributed fencing remain outside this API.

## 6. Security tools and release requirements

**API1-VERIFY-001.** Verification MUST use the pinned Signature/Codec rules,
complete operation context and host key authority over 1–32 uniquely identified
leaf sections. Every item's outcome MUST remain visible. Diagnostic output MUST
NOT include original bodies or private keys, and is never an execution ticket.

**API1-SCAN-001.** Scan MUST strictly parse the full input, visit at most 32
sections in preorder and return diagnostics without content. Malformed input
fails the request. Unsigned, unsupported and structurally nested sections have
explicit errors; root text remains untrusted. Offsets and recursive JSON scanning
are not defined by this version.

**API1-DECRYPT-001.** Decrypt MUST support the Security Tools 0.1 selected
encrypt-then-sign AES-256-GCM SYSTEM/CONTEXT leaf forms. Signature verification
over ciphertext and interpretation parameters MUST precede key resolution and
decryption. Exact owner/operation/policy/envelope/type/mode/zone grants, strict
Base64, a 32-byte key, 12-byte nonce, 16-byte tag and empty AAD are required.
Plaintext MUST be strict UTF-8 and at most 65,536 bytes. Sign-then-encrypt,
unsigned encryption, USER encryption, bootstrap encryption, other algorithms,
inline keys and recursive decryption MUST fail explicitly. Nonce uniqueness is
a producer obligation; this API exposes no encryption endpoint.

**API1-RELEASE-001.** Plaintext MUST be buffered until a host decision covers
every originating restriction, recipient and plaintext location with literal
allow/complete approval and deterministic CDL permission. Identity, operation,
signing authority and grants MUST be rechecked before release as specified in
Security Tools 0.1. Returned content is data with verified ciphertext provenance;
the original signature MUST NOT be represented as signing the new plaintext.
Hosts MUST enforce restrictions in callbacks and all later use. Successful
decryption does not authorize persistence, logging, inference or dispatch.

**API1-PROCESS-001.** Process MUST reject empty or untagged root input, require
verification, and suppress every content/provenance field if any item fails.
Previously successful candidates become `BATCH_REJECTED`. No optional flag may
disable verification or release checks. The result is a bounded list, not an
executable rebuilt prompt; nested plaintext MUST remain uninterpreted data.

## 7. Compatibility and migration decisions proposed for adoption

These are intentional API choices, not editorial corrections to PSP 3.2.0.
Adoption would authorize only explicitly selected API 1.0.0 behavior. It would
not retrospectively declare the Core examples compatible or erase their broader
obligations. A claim of full Core conformance still requires separate evidence.

| Core 3.2.0 example/obligation | API 1.0.0 choice | Migration |
| --- | --- | --- |
| Absent RFC-PSP-API reference | New versioned document, not historical reconstruction | Future Core reference names the reviewed API version; existing files remain unchanged |
| application_name/version and caller metadata | Host-published nodeId/nodeVersion; host identity | Host resolves application routing; discard identity claims from metadata |
| snake_case session fields and full workflow state | Exact camelCase schema and projected view | Explicit client adapter; no silent aliases or automatic casing conversion |
| Resume link/token in model-visible requests/results | Private host handoff and checkpoint ID | Host integrates approvals and notifications; no token passthrough adapter |
| RFC security examples without operation_id | Host-issued operation binding | Obtain a fresh authorized handle and signed scoped input |
| Optional verification/decryption switches | Mandatory verification and policy checks | Reject unsupported options; do not ignore or translate them into weaker behavior |
| Decrypt-then-verify example | Selected encrypt-then-sign only | Producers create the supported authenticated envelope; unsupported ciphertext is rejected |
| Scan offsets/content and unsigned inclusion | Bounded diagnostics and explicit unsupported items | Consumers must stop depending on offsets/content or unsigned promotion |
| processed_text ready for LLM injection | Structured data; all-or-nothing process release | Host constructs any later prompt under separate verification/dispatch policy |
| ISO timestamps and PSP_SEC_* examples | Exact schema timestamps and code strings | Typed conversion at the host boundary; no claimed one-to-one error mapping |

**API1-VERSION-001.** Clients MUST explicitly select the contract set and handle
unsupported features. API 1.0.0 adoption would require no storage rewrite, route
rename, response-profile replacement or automatic migration for existing 0.1
clients. Every writer/reader of lifecycle records must already understand
cancelled/purged states before enabling those extensions. Breaking wire or
authority changes require a new API major version; candidates remain distinct
until adoption. Older Core-example clients are not wire compatible by default.

## 8. Evidence, open boundaries and adoption

**API1-EVIDENCE-001.** An implementation claim MUST state the API revision,
required/optional operation coverage, transport, host assumptions and unsupported
cases. Name/schema matching alone is insufficient. The
[evidence map](contract-set-1.0.0.json) links shared service/workflow/lifecycle/
security cases, real two-way HTTP/MCP calls, restart/cleanup, races and rollback
checks. These are scoped implementation evidence, not an independent audit,
whole-Core conformance designation or effectiveness measurement.

The candidate makes unsupported encryption modes, offsets, recursive plaintext,
public ingress, delegated approval, physical erasure and distributed cancellation
explicit. They need separate future contracts; they are not implied promises of
API 1.0.0. Parser/alias/refresh errata PSP-E007–E009 remain a separate review.

The [companion erratum](../errata/PSP-API-EDITORIAL-0.2.md) proposes the versioned
reference disposition and eleven heading aliases. No archived RFC is rewritten.
At least fourteen calendar days of public comment, comment dispositions and a
recorded maintainer decision are required by [governance](../../GOVERNANCE.md).
Substantive changes receive a renewed full comment window. Acceptance, unresolved
objections and retained drafts are recorded separately; #35 stays open until the
decision. Package publication and M3/release gates remain unchanged.
After acceptance, editors publish a new final document and contract revision
with the decision reference; this candidate remains the historical review text.
