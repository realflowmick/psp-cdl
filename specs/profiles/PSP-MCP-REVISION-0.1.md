# PSP MCP Revision Profile 0.1

Status: **project draft, pending review**, September 22, 2026. Identifier: `PSP-MCP-REVISION-0.1`.

This opt-in extension of [dispatch](PSP-MCP-DISPATCH-0.1.md), [stdio](PSP-MCP-STDIO-0.1.md) and [HTTP](PSP-MCP-HTTP-0.1.md) mediation preserves PSP Core §11/§22.5 and CDL §5/§7 baselines. It is a project-specific MCP extension, not a standard MCP revision mechanism. It uses MCP 2025-11-25 [experimental capabilities](https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle) and [`_meta`](https://modelcontextprotocol.io/specification/2025-11-25/basic) fields.

## 1. Negotiation and discovery

Both initialization capabilities MUST include `experimental["psp-cdl.org/revision"] = {"profile":"PSP-MCP-REVISION-0.1"}`. A client requiring this profile MUST reject missing or different support; it MUST NOT fall back or automatically retry. A revision-only registry MUST reject ordinary discovery and invocation. A dispatcher MUST reject revision metadata on calls without prior negotiation and MUST reject a request-local service that loses negotiated support.

Each tool descriptor carries `_meta["psp-cdl.org/revision"] = {"toolRevision": identifier}`. The sorted complete catalog is hashed with SHA-256 over UTF-8 JCS. Tool names use the dispatch profile's ASCII grammar. The `tools/list` result carries `_meta["psp-cdl.org/revision"]` with exactly `profile`, `epoch`, `generation`, and `catalogDigest`. Epoch is an opaque host registry-instance identifier; generation is an integer from 1 through 2^53−1; digests are lowercase 64-character hex. The epoch MUST be unique across registry restarts. The default implementation generates a UUID; supplying one transfers uniqueness responsibility to the host.

Hosts MUST review the detached `{tools, revision, approvalDigest}` snapshot and explicitly approve `approvalDigest = SHA256(JCS({tools, revision}))` when creating registrations. Approval MUST bind exact schemas, tool revisions, read-only admission and a complete union of host-reviewed capability declarations. Server metadata is evidence to review, never authority to grant access. Approval does not replace current node affinity or per-call CDL policy.

## 2. Invocation precondition and publication

Call parameters carry `_meta["psp-cdl.org/revision"]` with exactly the discovered catalog descriptor plus `toolRevision` and `inputDigest = SHA256(JCS(arguments))`. This input only narrows an independently authenticated and authorized invocation. It MUST NOT grant identity, scopes, workflow/session selection, policy or capability authority, and MUST NOT be copied into model/tool arguments.

After authenticating and authorizing the caller, the server MUST atomically compare the entire precondition, select the registered callback and acquire an execution lease. Mismatch MUST invoke no callback. All catalog publishers MUST share the same registry. Publication uses compare-and-replace on the complete descriptor, fails while any lease is active, and increments generation even when the catalog bytes are unchanged. Exhausted generation MUST fail closed. Invalid candidates or conflicts MUST leave the active catalog unchanged. These rules prevent an A→B→A catalog sequence from revalidating an earlier precondition.

The lease lasts through callback completion, bounded object output copying, cancellation checks, release reauthentication/authorization and receipt construction. It MUST be released on success or failure. Successful result `_meta["psp-cdl.org/revision"]` echoes the exact precondition. Clients MUST verify that receipt and recheck the complete catalog before and after a call, then apply the normal schema/CDL release gate. An absent or mismatched receipt suppresses output. The receipt is an unsigned consistency assertion from the authenticated peer, not an independent attestation or proof of security.

The host MUST keep callback behavior and its dependencies/configuration immutable under an advertised revision, and publish behavior changes through this registry. Merely reusing the same function reference does not enforce that condition. The registry does not validate general JSON Schema, implement a PDP, freeze remote dependencies, stop a dishonest peer or coordinate multiple processes. The receiving host remains responsible for tool-specific input validation and authorization. Only read-only tools are supported.

## 3. Host-approved refresh

An established peer remains pinned. Refresh MUST use a fresh peer, fresh authenticated discovery and explicit host approval. Once the candidate registrations are fully validated, the host may compare-and-replace the gate's complete registry while the gate is idle. The busy period begins before authentication and ends after result construction or failure, across all owners using that gate. Busy, stale expected revision, invalid candidate and reused local registry revision MUST fail without partial replacement. Local revision history is bounded to 4,096 entries; exhaustion requires a new host lifecycle.

The gate MUST retain externally supplied authority checks. The host separately publishes authority naming the new registry revision; calls in the intervening gap fail stale. Hosts MUST serialize their administrative publication and apply replacements to every serving gate under their routing control. The old connection may be retired after successful publication. A failed candidate must be closed by the host without replacing the active peer. No model-visible refresh, approval, publication or credential endpoint is introduced. `tools.listChanged` remains false; automatic acceptance of change notifications is unsupported.

## 4. Bounds, failures and evidence

Existing 1 MiB JSON, 1,024-tool, finite-schema, credential, cancellation and transport bounds remain. Registry errors include `REVISION_REQUIRED`, `REVISION_UNSUPPORTED`, `INVALID_PRECONDITION`, `REVISION_MISMATCH`, `REVISION_CONFLICT`, `REGISTRY_BUSY` and `REVISION_EXHAUSTED`. Clients expose `CATALOG_NOT_APPROVED`, `DISCOVERY_MISMATCH`, `DISCOVERY_CHANGED`, `INVALID_REVISION_DATA` and `INVALID_REVISION_RECEIPT`. The proxy sanitizes remote invocation failures to `TOOL_FAILED`; it does not forward arbitrary remote error text. A rejected receipt or post-call drift can suppress output but cannot undo an invocation or disclosed input.

[Shared vectors](../../conformance/vectors/dispatch/revision-0.1.json) and mixed-language process tests cover stale preconditions, ABA, blocked publication, approval, replacement and released output. These synthetic checks do not establish production readiness, independent review, security effectiveness or complete MCP/PSP/CDL conformance. Distributed publication, mutating tools, automatic refresh and recovery remain unsupported.

Dedicated to the public domain under CC0 1.0 Universal; see [license](../../LICENSES/CC0-1.0.txt).
