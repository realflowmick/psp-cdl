# PSP MCP Dispatch Profile 0.1

Status: **project draft, pending review**, September 22, 2026. Identifier: `PSP-MCP-DISPATCH-0.1`.

This opt-in bounded implementation profile supplies a host-embedded gate for the first M4 slice. It uses PSP Core 3.2.0 §11, CDL 1.5 §5 and §7, [CDL-DETERMINISTIC-1.0](CDL-DETERMINISTIC-1.0.md), and [PSP-TRUST-1.0](PSP-TRUST-1.0.md). It does not change a published baseline or claim full MCP proxy, Topology B/C or RFC conformance. The [shared JSON contract](../../schemas/mcp-dispatch.schema.json) describes library calls/results, not a new MCP wire protocol.

## Authority and registration

The trusted host MUST authenticate callers and require `tools:list` or `tools:call`. The host selects the session outside model-visible tool arguments. The store MUST check tenant/subject ownership, expiry and running status. Credentials, authoritative session state and policy inputs MUST remain outside model input.

A registry is immutable for the gate's lifetime. The host MUST obtain endpoint identity, schemas, capability inventories and revision from authenticated discovery or a trusted local registration. A remote tool's descriptions or read-only annotations alone MUST NOT authorize admission. Each registration contains `server`, `name`, `revision`, host-approved boolean `readOnly`, `sources`, `complete`, `inputSchema`, `outputSchema` and an endpoint callback. The callback owns transport authentication; no endpoint URL is accepted from a call. Incomplete or unsupported inventories reject registry construction. A changed registry requires a new gate and a changed authoritative registry revision.

Server/tool names are case-sensitive ASCII letters, digits, `_` and `-`, 1–64 characters each. The exposed name is `server.name`; affinity uses `mcp://server/name`. Duplicate exposed names reject construction. This slice accepts exact comma-separated MCP URIs in the immutable node definition's `agents` field, ignoring surrounding ASCII space, tab, CR and LF. Missing/empty `agents` grants nothing. Duplicate URIs are harmless. Wildcards, other schemes and unresolved hierarchical declarations are unsupported. Hosts MUST provision the node's effective, authorized flat affinity before admission; this gate does not calculate inheritance or transitions.

## Dispatch and release

The host supplies a fresh authority snapshot with `revision`, `policyVersion`, `registryRevision`, integer `expires`, `releaseSources` and `releaseComplete`. Policy and registry revisions MUST match the session and installed registry. Release sources MUST cover the actual recipient, logging, caching and downstream paths. Discovery exposes only allowed read-only tool names and schemas; it does not authorize a subsequent call.

Calls accept exactly `name` and object `arguments`. Non-read-only registrations return `UNSUPPORTED_TOOL_MODE`. Arguments and output MUST match the finite schema subset below. JSON values are detached and limited to the persistence profile's 1 MiB canonical UTF-8 bound. Output is a single buffered object; streams, incremental release and raw transport envelopes are unsupported.

Before dispatch, the gate builds a binding with tenant, subject, session/version, node/version, backend epoch, policy/authority/registry/tool revisions, tool URI, SHA-256 of JCS arguments, host deadline and phase. Before release it also binds the output digest. The host policy callback receives detached binding/data and MUST return its `bindingDigest` and nonempty `resources` array. Each resource is an originating CDL policy unit; hosts MUST resolve every contributing input/output location, retain origins and obtain fresh operation-bound evidence. The digest binds evidence to the request; it is not a signature or a portable authorization token.

The gate unions all registered tool/server/transitive capability sources with each resource's capabilities before dispatch, evaluates CDL deterministically, and invokes only on `allow`. Release uses the complete recipient inventory and resource policies. Unsupported policy yields `UNSUPPORTED_POLICY`. Policy or registry drift, lost authentication/scope, session changes, cancellation and expiry stop the next boundary. Endpoint failures are sanitized, with no automatic retry.

The returned provenance records the gate profile, tool URI/revision, registry revision, input/output digests and trust level **5**. Authenticated routing does not promote returned text to instructions. These local metadata are not signed attestations and must not be trusted after unauthenticated transport. Display or inference integration MUST honor the recipient evaluated by the release policy; rerouting requires a new decision.

## Single-process coordination and deadlines

All stores that can write the same owner state and all gates MUST share one `OwnerCoordinator`. It excludes competing operations by `(tenantId, subjectId)` and returns `STATE_BUSY` immediately rather than queuing. Mutations acquire it for the full store operation; a gate holds it from session resolution through endpoint completion and output checks. Reads remain available. Reservations release in `finally` after success or failure; they are not persisted.

The host MUST use the same coordination boundary for authoritative per-owner policy, registry and credential changes requiring atomic invalidation. Freshness checks also detect observed changes but cannot make arbitrary external writes atomic. Direct database writers, independent coordinators, distributed workers and cross-process dispatch are outside this profile. This does not add a database lock spanning a remote call.

Deadlines use the host clock's nonnegative safe-integer unit consistently with store expiry. Cancellation is a host callback returning exactly a boolean. Both are checked at boundaries and supplied to the endpoint adapter. Adapters MUST enforce I/O deadlines and cooperate with cancellation. A non-returning callback can retain the reservation indefinitely; the gate neither kills threads nor releases the reservation while an endpoint is still running. A timeout after dispatch suppresses output; it cannot retract data already sent. Durable effect permits, exactly-once effects and outbox recovery are unsupported.

## Finite schema subset

Every schema MUST have one `type`: `object`, `array`, `string`, `number`, `integer`, `boolean` or `null`. Optional nonempty `enum` (at most 1,024 values) uses JCS equality. Objects require `properties`, unique `required` names drawn from properties, and `additionalProperties: false`. Arrays require `items`; optional `minItems`/`maxItems` constrain length. Strings accept optional `minLength`/`maxLength` counted in Unicode code points. Numbers/integers accept optional inclusive `minimum`/`maximum`. Length bounds are nonnegative safe integers; lower bounds cannot exceed upper bounds. Nesting deeper than 16 is unsupported. Input/output roots MUST be objects.

All other keywords, including `$ref`, combinators, annotations, `format`, patterns and open-ended object members, yield `UNSUPPORTED_SCHEMA`; they are never silently ignored or fetched. CDL annotations are resolved by the trusted host into policy resources separately from these validation schemas. Non-finite numbers and non-JSON values fail before validation. No claim of general JSON Schema support is made.

## Evidence

[Shared scenarios](../../conformance/vectors/dispatch/gate-0.1.json) observe actual local endpoint callbacks, denials, output suppression, schema handling and provenance digests in TypeScript and Python. Additional concurrent tests cover held endpoints and competing store transitions. These establish the bounded behavior under synthetic host assumptions, not network authentication, complete mediation, production readiness or measured attack resistance.

Dedicated to the public domain under CC0 1.0 Universal; see [license](../../LICENSES/CC0-1.0.txt).
