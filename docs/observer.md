# Development observer (PSP-OBSERVE-0.1)

The buffered loops in `llmproxy` and the dispatch gate in `mcpproxy` accept an
optional observer. It is a fire-and-forget development and telemetry hook: a
host passes a callback, the library calls it synchronously at fixed points, and
nothing the callback does can change a decision, a code, a call count or a timing
check. It exists so that tooling such as PSP Studio can show what the loop is
doing while it runs. It is not an audit channel, not evidence, and it asserts no
security property. See the [shared schema](../schemas/observer-0.1.schema.json)
and the [shared vectors](../conformance/vectors/llm/observer-0.1.json).

```ts
import { BufferedLlmLoop } from "@psp-cdl/llmproxy";
import { McpDispatchGate } from "@psp-cdl/mcpproxy";
const observe = { observer: event => sink.write(event), level: "digest" };
const gate = new McpDispatchGate(store, dispatchHost, "registry-1", registrations, observe);
const loop = new BufferedLlmLoop(store, gate, host, provider, observe);
```

```python
from psp_cdl_llmproxy import BufferedLlmLoop
from psp_cdl_mcpproxy import McpDispatchGate
observe = {"observer": sink.write, "level": "digest"}
gate = McpDispatchGate(store, dispatch_host, "registry-1", registrations, observe=observe)
loop = BufferedLlmLoop(store, gate, host, provider, observe=observe)
```

`DurableLlmLoop`, `RefreshingLlmLoop`, `RedirectingLlmLoop`, `ScopedLlmLoop` and
`ContextLlmLoop` take the same trailing argument and pass it to the buffered
rounds they create. Omitting it changes nothing. The option object must contain
exactly `observer` (a function) and an optional `level`; any other shape fails
construction with `INVALID_CONFIGURATION`, like every other configuration error.

## Guarantees

- **Isolated.** Each emission is wrapped: an observer that throws, returns a
  rejected promise, or mutates its argument has no effect. Events are detached
  copies. The shared vectors compare outcomes with and without an observer.
- **Synchronous.** Emission adds no `await` and never reads the host clock, so
  freshness checks, reservations and the "no await before the pinned endpoint"
  rule are unchanged. Observers that need asynchronous work must queue it.
- **Scoped.** `scope` carries only a well-typed subset of the binding:
  `sessionId`, `requestId`, `step`, `round`. Host bindings, principals,
  credentials, verification keys and policy resource contents are never copied.
- **Two levels.** `digest` (default) carries sizes, digests, counts, codes and
  decisions. `inspect` additionally attaches `data.payload` with model-visible
  material: messages, candidates, tool data, planned state and retained data.
  Inspect output contains user text and application content; keep it local.

## Events

Every event is `{profile:"PSP-OBSERVE-0.1", source, type, scope, data}`.
Byte counts are UTF-8 lengths of canonical JSON (or of the text itself for
`textBytes` and `inputBytes`); digests reuse `bindingDigest`.

| Source | Type | Data (digest level) |
| --- | --- | --- |
| llmproxy | `turn.start` | `inputBytes`, `maxSteps`, `deadline`, `providerId`, `providerRevision` |
| llmproxy | `session.loaded` | session/authority identifiers, `expires`, `stateBytes` |
| llmproxy | `prompt.loaded`, `prompt.replaced` | `digest`, `textBytes`, `version`, `trustLevel`, `timestamp`, `expires` |
| llmproxy | `tools.listed` | `count`, `names` |
| llmproxy | `step.start`, `prompt.assembled` | `step`; `messageCount`, `bytes`, `toolCount`, `promptDigest` |
| both | `cdl.decision` | `phase` (inference, tool, release, dispatch, recovery), `decision`, `reasonCodes`, `resourceCount` |
| llmproxy | `inference.start`, `inference.end` | `bytes`, `messageCount`; `ok` |
| llmproxy | `model.candidate` | `type` (tool, final, invalid), `toolName`, `textBytes` |
| llmproxy | `dispatch.requested`, `transcript.grew` | tool name and argument bytes; `messageCount`, `bytes`, `dataBytes`, `limit` |
| llmproxy | `final.authorized`, `turn.buffered`, `turn.failed` | `outputDigest`, `textBytes`; `steps`; `code` |
| llmproxy | `lockdown`, `turn.planned`, `turn.committed`, `turn.released`, `turn.recovered`, `durable.failed` | lockdown time; `stateBytes`, `retainedBytes`, `complete`; `sessionVersion`, `status`; `code` |
| llmproxy | `refresh.due`, `refresh.signal` | `trigger`; the refresh audit signal with version metadata or failure code |
| llmproxy | `round.start`, `service.proposed`, `service.result`, `checkpoint.waiting`, `round.answer`, `context.failed` | round index, history and view sizes, operation, event kind and result size |
| mcpproxy | `dispatch.enter`, `dispatch.start`, `dispatch.guard` | operation and allow-list counts; tool identity, `inputDigest`, `argumentBytes`; host guard presence and result |
| mcpproxy | `tool.invoke.start`, `tool.invoke.end`, `tool.output` | `toolName`; `ok`; `outputBytes`, `outputDigest` |
| mcpproxy | `dispatch.released`, `dispatch.failed` | `toolName`, `outputDigest`; `operation`, `code` |

`cdl.decision` exposes the reason codes that the loop and gate otherwise reduce to
a single error code. The durable loop persists no conversation history, so every
durable turn restarts from `[system, user]`; only `turn.committed.stateBytes` and
`retainedBytes` carry across turns. That is the "dropped context" a viewer sees.

## Parity and checks

Both languages emit the same events in the same order with the same digest-level
data. `python scripts/check-observer-parity.py` runs the shared cases through the
existing synthetic fixtures with an observer attached and compares the full event
lists; `python scripts/generate-observer-vectors.py --check` and
`python scripts/generate-observer-schema.py --check` verify the draft artifacts.
Prompt-derived digests bind the random session id and are redacted before the
comparison. Provider token usage is not part of this profile; the OpenAI adapter's
existing `onUsage` hook remains the token source.

## Limitations

The observer reports what the library did, not what a model decided or whether
any attack was prevented. Emission order is the synchronous call order; the
observer assigns its own sequence numbers if it needs them. Streaming, partial
output and provider-side events remain unsupported.
