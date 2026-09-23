# Buffered model/tool loop

`BufferedLlmLoop` implements the first experimental M5 slice in TypeScript and
Python. It assembles a prompt from a verified host-signed system section and user
text, checks CDL before inference, routes model tool requests through the existing
MCP dispatch gate, and returns only a buffered final answer approved by the host
and release policy. See the [draft profile](../specs/profiles/PSP-LLM-LOOP-0.1.md),
[shared schema](../schemas/llm-loop.schema.json), and
[runnable synthetic examples](../examples/llm/README.md).

```ts
import { BufferedLlmLoop } from "@psp-cdl/llmproxy";
const loop = new BufferedLlmLoop(store, gate, host, provider);
const result = await loop.run(credential, trustedSessionId, {message: userText}, {
  deadline: host.now() + 30, cancelled: () => signal.aborted, maxSteps: 8
});
```

```python
from psp_cdl_llmproxy import BufferedLlmLoop
loop = BufferedLlmLoop(store, gate, host, provider)
result = loop.run(credential, trusted_session_id, {"message": user_text}, {
    "deadline": host.now() + 30, "cancelled": cancelled_event.is_set, "maxSteps": 8
})
```

These snippets assume seconds. The host supplies clock units and controls.
Python callbacks are synchronous; TypeScript callbacks may return promises.
Importing the package opens no listener or database and looks up no credentials.
The credential needs `models:invoke`, `tools:list`, and `tools:call` for tool use.
The session selector and controls come from authenticated host routing.

## Host and provider contracts

| Input | Responsibility |
| --- | --- |
| `store`, `gate` | Same workflow store instance with a shared `OwnerCoordinator`; coordinate every writer and host authority publisher. |
| Provider | `{id, revision, sources, complete, invoke}`; authenticated, complete transitive capabilities; credentials inside the adapter closure. `invoke` receives only `{messages, tools}` and deadline/cancellation controls. |
| `authenticate` / `now` | Current tenant, subject, scopes and integer clock. Revocation is rechecked at boundaries. |
| `snapshot` | `{revision, policyVersion, providerId, providerRevision, registryRevision, expires, releaseSources, releaseComplete}` for the actual provider and final recipient. Policy version must match the durable session. |
| `prompt` | A signed text `system` envelope at trust level 1 or 2, using every attribute returned by `promptContext(binding)` / `prompt_context(binding)`. Only its verified text goes to the provider. |
| `verification` | Fresh `{keys, clockSkew?}` for core verification; keys must prohibit unscoped use. The loop supplies the exact required context, allowed attributes and clock. |
| `policy` | Resolve all contributing restrictions/evidence for `{request, candidate?}` at `inference`, `tool` and `release`; return `{bindingDigest, resources}` using the MCP gate's digest helper. Empty resources reject. |
| `authorizeFinal` / `authorize_final` | Return exactly `true` to permit the checked final candidate. This does not authorize a durable workflow transition. |

The policy binding includes phase, step, prompt digest and digest of the entire
checked data, in addition to private session/provider/policy identity. Callback
arguments are detached copies. Every earlier message and tool result remains in
the transcript provided to the policy resolver. Hosts must conservatively carry
restrictions into model-derived arguments and answers; they cannot infer that
summarization removed a restriction. Resource path capabilities are merged with
the actual provider/tool/recipient capabilities before the shared PDP evaluates
them. Trusted evidence belongs in the policy resolver, never in model output.

The gate's host-only `authorizeDispatch` option lets the loop perform these
additional checks while the gate holds its reservation. This option cannot
relax gate checks and is not forwarded to the endpoint or accepted over MCP.
Gate release capabilities must describe the intermediate loop receiving path;
the loop separately checks provider and final display recipients.

## Results and limits

The provider returns exactly `{type: "tool", name, arguments}` or
`{type: "final", text}`. Only discovered read-only tools are eligible. Parallel
calls, extra authority fields, iterators/streams and malformed responses reject.
There are at most 32 inference steps and 1 MiB of canonical JSON per value and
accumulated transcript, plus the core JSON structural bounds. A tool request on
the last permitted step fails before dispatch. No automatic retries occur.

The returned value is `{text, provenance}`. Provenance has trust level 5, a digest
of `{text}`, provider/revision, profile and step count; it is a local unsigned
record. Errors expose a stable code without provider/host exception details.
Cancellation, expiry, stale authority, denied policies and failed callbacks
release no result. Adapters must bound their I/O and honor cooperative controls.
Already-dispatched inference/tool reads cannot be undone.

Completed and paused sessions reject before inference. A model's `final` response
does not complete a session in this class. The separate opt-in
[durable loop](llm-durable.md) adds atomic turns, host-approved completion,
lockdown and authorized recovery. Scoped/redirect policy, automatic refresh,
streaming, live-provider adapters and multi-worker coordination remain unsupported. A fresh
host-authorized invocation can supply a new signed prompt after expiry. This
slice establishes no model attention isolation, full topology conformance or
measured security effectiveness.

Run the normal repository checks and `python scripts/check-llm-parity.py` after
building both workspaces. The 69 shared cases compare actual provider/tool calls,
suppressed output, provider-visible transcripts and provenance; language tests
also hold a provider callback while competing owner operations are rejected.
