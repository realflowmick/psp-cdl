# PSP Buffered LLM Loop 0.1

Status: project draft, experimental opt-in library contract. This is the first
M5 slice, not full PSP/CDL conformance or measured security effectiveness.
Published RFCs remain unchanged. Basis: PSP Core 3.2.0 §17 (signatures), §8.5
(post-completion), §21.7–21.19 (refresh); CDL 1.5 §7.1–7.6 (matching and mediation),
and PSP-TRUST-1.0 §2–3.

## Boundary

The host selects an authenticated credential, durable session, provider adapter,
deadline and step budget. The only user request is `{message: string}`. Model
responses are exactly `{type: "final", text: string}` or
`{type: "tool", name: string, arguments: object}`. Extra fields, streams,
parallel calls, malformed values and oversized values reject. A final response
ends this invocation; it does not complete the durable workflow.

The host supplies one signed text `system` envelope, restricted to trust level
1 or 2, with all attributes returned by `promptContext(binding)`. Those bind
tenant, subject, session/version, node/version, store epoch, policy, authority,
provider/revision and tool registry revision. The loop verifies cryptography,
key scope, revocation and exclusive expiration through the core API. Verification
policy is resolved anew at every boundary. Model input contains the verified
text and separated user/tool messages, never envelope attributes, credentials,
keys or authoritative session state. Role separation is not attention isolation.

Provider registrations and their complete transitive capabilities are host-owned.
Provider credentials belong inside adapter closures. The host returns a pinned
authority snapshot and resolves nonempty CDL resources for the complete
transcript and candidate at `inference`, `tool` and `release` boundaries.
Each policy result binds to the digest of the exact operation context, including
the data digest and phase. Every contributing restriction must survive derivation;
the host must conservatively resolve the full transcript, tool descriptions,
arguments and outputs, including logs/caches. Empty or unsupported facts reject.
The loop merges recipient capabilities with each resource's path capabilities
and evaluates the shared deterministic PDP. `authorizeFinal` additionally
permits or rejects the exact final candidate; model claims never authorize it.

## Coordination and release

`BufferedLlmLoop` and `McpDispatchGate` must share the same `WorkflowStore` and
`OwnerCoordinator`. All writers and host authority publishers must participate
in coordination. Provider calls and final release checks hold the owner
reservation. Tool calls acquire the existing gate reservation; its optional
host-only `authorizeDispatch` callback rechecks the loop's exact session,
authority and signature and evaluates transcript-derived resources against
the actual registered tool's capabilities. The gate's normal affinity, schema,
policy and output checks still execute. The callback cannot weaken them.
It is not accepted from a transport request or model arguments.

Authentication, current session, snapshot, registry and signature are checked
before inference/dispatch and after callbacks before release. Changes fail
closed. Completed or paused sessions never invoke the provider. Concurrent
owner operations return `STATE_BUSY`. Cross-process writers, uncoordinated host
changes and malicious host callbacks are outside this local coordination claim.

All requests, responses and accumulated transcripts are bounded to 1 MiB of
canonical JSON (and core JSON nesting/node bounds). The host chooses 1–32
inference steps. A tool request at the final step returns `STEP_LIMIT` before
dispatch because there is no remaining inference step to consume its result.
No text, partial result or raw exception is returned on failure. Only a checked
final text with level-5 local provenance leaves the loop. Tool data is checked
again for the provider before its next inference request. The dispatch gate's
release recipient must describe the loop's actual intermediate receiving path.

Cancellation and deadlines are cooperative. Pending adapters retain reservations;
late output is suppressed. There are no automatic retries. Adapters must bound
their I/O; an uncooperative callback cannot be forcibly stopped by this library.

## Unsupported and follow-up

Live provider integrations, streaming, parallel/mutating tools, transcript
persistence, durable completion transitions and PSP post-completion policies,
refresh scheduling/replacement, audit signals, multi-worker orchestration and
attention isolation are unsupported. Expiration stops this invocation; a host
may start a new invocation with a freshly authorized prompt. No expired grace
or model-directed refresh is implemented. A final answer cannot alter workflow
state. Further M5 work needs separate contracts and acceptance cases.

Dedicated to the public domain under CC0 1.0 Universal; see
[license](../../LICENSES/CC0-1.0.txt).
