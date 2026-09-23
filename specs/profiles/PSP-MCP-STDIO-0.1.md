# PSP MCP Stdio Mediation Profile 0.1

Status: **project draft, pending review**, September 22, 2026. Identifier: `PSP-MCP-STDIO-0.1`.

This opt-in implementation slice connects [PSP-MCP-DISPATCH-0.1](PSP-MCP-DISPATCH-0.1.md) to MCP [2025-11-25 lifecycle](https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle), [tools](https://modelcontextprotocol.io/specification/2025-11-25/server/tools) and [stdio](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports). It implements bounded stdio mediation under PSP Core §11 and CDL §5/§7, without changing their published baselines. It does not claim full MCP client/server support, remote network authentication or Topology B/C completeness.

## 1. Authentication and authority

The upstream launcher MUST establish the authorized local peer and supply a credential callback, fixed host-selected workflow session and execution controls outside JSON-RPC. The proxy authenticates every message, pins tenant/subject at initialization, and pins that principal again when entering the gate. `tools:list` and `tools:call` require their respective scopes. The credential and session selector MUST NOT be accepted from model arguments or request `_meta`.

The downstream launcher configuration MUST be trusted host configuration: an absolute executable path, argument vector, explicit environment, expected server name/version and wall-clock request timeout of 1–30,000 ms. Launching uses no shell and no inherited environment. On Windows, child windows are hidden. Paths, dependencies, credential injection, executable provenance, permissions and local process isolation belong to the host. A server's self-reported name/version is checked for mismatch but is NOT an authentication mechanism. Identity rests on the trusted launcher and its dedicated pipes. Peer diagnostics MUST NOT be forwarded to model-visible output.

The host MUST approve each tool's name, schemas, revision, read-only status and complete capability sources before registering it with the gate. MCP annotations and discovered capability text MUST NOT create those approvals. Approval schemas must match discovered input/output schemas exactly under JCS. Unapproved tools cannot acquire a route through model selection. Connection configuration and the [result schema](../../schemas/mcp-stdio.schema.json) are shared contracts, not a new MCP version.

## 2. Upstream interface

The proxy reuses the reference MCP dispatcher and stdio framing. Supported methods are initialize, initialized notification, ping, tools/list and tools/call. Tools use the gate's `server.name` names and exact active-node affinity. Discovery schemas describe the actual `structuredContent` data; gate provenance is carried separately in `_meta["psp-cdl/provenance"]`. Text content is regenerated from the checked structured object. Tool errors contain stable local codes, with no raw downstream errors or text.

Request `_meta` is accepted as inert metadata. Unknown methods are rejected locally, not relayed. Notifications never execute tool calls. Gate/session/policy checks remain mandatory on every call; discovery is not a reusable authorization permit. This sequential dispatcher does not implement tasks, progress, subscriptions, resources, prompts, server-to-client requests or wire-level cancellation of an in-flight request.

## 3. Downstream binding and drift

The client negotiates the pinned MCP version and checks expected server information and tool capability advertisement. It requires a complete single-page tools/list result, at most 1,024 uniquely named tools, with object input/output schemas. Pagination is explicitly unsupported. The entire sorted discovery response is hashed using SHA-256/JCS, including untrusted metadata; changes to any discovered tool or metadata invalidate this static connection.

Before every tools/call and again before accepting its result, the client obtains tools/list and compares that digest. Observed drift prevents the next boundary; pre-call drift results in no tools/call. These checks are not atomic remote revision preconditions. The host MUST keep the dedicated endpoint implementation and its approved capability behavior stable for the connection lifetime. A dishonest peer or an unobserved change between requests cannot be excluded by polling or self-declared metadata. No stronger claim is made.

Only the pinned registered downstream tool name receives checked arguments. No model-supplied URL, process, method, credential or metadata is forwarded. Tool responses require an object `structuredContent`, absent or false `isError`, and zero or one text content block. If text is present it MUST parse as strict JSON equal to the structured object. Images, embedded resources, differing text and other result members are unsupported. Downstream `_meta` is discarded; even claimed level-0 provenance cannot promote data. The gate then applies its output schema, release policy, freshness checks and level-5 provenance.

Malformed, oversized, invalid-UTF-8 or truncated frames, mismatched response IDs, remote JSON-RPC errors, unsolicited messages and failed revalidation poison the connection. It is closed without automatic retry or reconnect. A fresh connection and host registration are required for recovery. The process is dedicated to this client; one request is outstanding at a time.

## 4. Bounds and cancellation

Input and output stdio frames are strict UTF-8 newline-delimited JSON, each at most 1 MiB excluding the newline. The entire serialized response is bounded before any bytes are written; the structured/text duplication can make an otherwise valid data object too large for transport. Partial governed content is never streamed.

Each downstream exchange has a real monotonic/wall timer independent of the policy clock. During invocation, the adapter also samples the host's cancellation and policy-clock deadline. Cancellation or timeout terminates the owned direct child and suppresses the result. The gate releases its owner reservation when the adapter finishes. Inbound MCP cancellation notifications are not processed during a blocking call by this sequential transport; applications must use host controls or the finite exchange timeout. Python uses bounded background I/O queues so a blocked pipe write cannot defeat that timeout. These controls do not retract a request already sent, sandbox a process, kill arbitrary descendant processes or establish exactly-once effects.

Streamable HTTP, OAuth, SSE, remote TLS identity, general multi-client multiplexing, hot discovery refresh, mutating tools and distributed effect recovery remain unsupported. All prior dispatch-profile host obligations and topology limitations continue to apply.

## 5. Evidence

[Shared mediation scenarios](../../conformance/vectors/dispatch/stdio-0.1.json) run actual downstream processes in both languages and check tool-spy counts and released responses. Additional mixed-language chains run Python client → Node proxy → Python downstream and the reverse. Cases cover observed discovery drift, authorization and policy denial, malformed output, forged metadata, bypass methods, invalid transport frames and bounded hangs. Additional tests cover host cancellation, connection identity pinning and zero-byte output on frame overflow. Installed-package checks exercise the same public transport APIs. This is scoped synthetic evidence, not production readiness, complete conformance or measured attack resistance.

Dedicated to the public domain under CC0 1.0 Universal; see [license](../../LICENSES/CC0-1.0.txt).
