# Buffered OpenAI provider adapter

`createOpenAIChatProvider` (TypeScript) / `create_openai_chat_provider` (Python)
returns the provider registration accepted by `BufferedLlmLoop`. The
[draft profile](../specs/profiles/PSP-OPENAI-CHAT-0.1.md) pins OpenAI Chat
Completions `/v1/chat/completions` and `gpt-4.1-mini-2025-04-14`. This is an
experimental paired mapping, not complete M5 functionality or a security study.

The existing loop still verifies the signed prompt, current owner/session,
provider revision, transcript-wide CDL and tool/final release authorization.
The adapter converts namespaced tools to deterministic provider function names,
reconstructs call/result pairs from the supplied transcript, and buffers one
validated tool request or final answer. It retains no conversation or call-ID
state. Live and offline provider IDs differ, so a host must explicitly approve
switching from a fake provider to the live registration.

## Host integration

```ts
import {createOpenAIChatProvider, BufferedLlmLoop} from '@psp-cdl/llmproxy';
const provider = createOpenAIChatProvider({
  mode: 'live', allowLive: true, apiKey: hostSuppliedKey,
  now: () => Math.floor(Date.now() / 1000),
  sources: hostApprovedTransitiveSources, complete: true,
  limits: {maxRequestBytes: 65536, maxResponseBytes: 65536,
    maxOutputTokens: 256, maxCalls: 2, budgetTokens: 2095664, timeoutMs: 15000}
});
// Host snapshot and signed prompt must bind provider.id and provider.revision.
const loop = new BufferedLlmLoop(store, gate, host, provider);
```

```python
import time
from psp_cdl_llmproxy import create_openai_chat_provider, BufferedLlmLoop
provider = create_openai_chat_provider({
    'mode': 'live', 'allowLive': True, 'apiKey': host_supplied_key,
    'now': lambda: int(time.time()),
    'sources': host_approved_transitive_sources, 'complete': True,
    'limits': {'maxRequestBytes': 65536, 'maxResponseBytes': 65536,
               'maxOutputTokens': 256, 'maxCalls': 2,
               'budgetTokens': 2095664, 'timeoutMs': 15000},
})
loop = BufferedLlmLoop(store, gate, host, provider)
```

Construction performs no network I/O. These snippets are host integration
examples with deliberately undefined host inputs; they are not runnable live
defaults. Keep API keys and authoritative routing in the host. Do not put them in
user input, prompt text, tool arguments or the provider request. Match the host
and adapter clock units (integer seconds). Capability sources must describe the
actual account and transitive paths; `store: false` does not prove a retention or
training property. Use distinct registrations for separately budgeted owners.

Supply `deadline` and `cancelled` on every loop invocation. The adapter applies
its own monotonic timeout too. Request/response limits apply to UTF-8 wire bytes;
canonical JSON and structural limits also apply. Live transport verifies TLS,
rejects redirects and compression, closes cancelled I/O, and never retries.
API errors expose codes only. The loop keeps its existing `PROVIDER_FAILED`
mapping for adapter failures, while its own cancellation/deadline errors remain.

Budget admission reserves **1,047,576 + maxOutputTokens** tokens per attempt,
including failed or cancelled attempts, and enforces `maxCalls`. The two-call
example above therefore reserves 2,095,664 tokens. This deliberately conservative
bound uses the entire pinned model context allowance without relying on a local
tokenizer or provider usage refund. It is not expected usage or a dollar price.
Hosts manage monetary, distributed and account-wide limits separately. A new
factory resets the local budget only through an explicit host action.

Only one request may be pending per registration. A transport that does not
settle after cancellation continues to occupy that slot. Python cancellation
can leave a DNS worker pending; it checks cancellation before submitting the
HTTP request after connection. Remote work already submitted may still be billed.

## Offline validation

Use `mode: 'offline'` with `transport(body, signal)` in TypeScript, or
`transport(body, stop_event)` in Python. Omit `allowLive` and `apiKey` entirely.
The callback receives UTF-8 request bytes and returns
`{status, contentType, body}` where `body` is a `Uint8Array` / Python `bytes`.
This trusted synthetic callback must honor cancellation. Live factories reject
replacement transports; there is no production custom-URL switch.

After building TypeScript and syncing the Python workspace:

```sh
uv run --locked python scripts/generate-provider-artifacts.py --check
uv run --locked python scripts/check-provider-parity.py
uv run --locked python scripts/check-provider-http.py
```

The shared cases run in both language suites and parity checks. They compare
actual wire requests, call counts, output suppression and real loop boundaries.
The HTTP checks intercept only the test process's fixed endpoint and connect
both native TLS transports to ephemeral local test servers. They use synthetic
credentials and check success, chunked buffering, TLS trust/hostname rejection,
redirects, errors, size limits, truncation, stalled I/O and cancellation.

## Optional synthetic live smoke

**Live check status for this implementation: not run.** Imports, CI and offline
examples make no paid requests. These commands are separately invoked and may
incur provider charges. Supply `PSP_OPENAI_API_KEY` through your host environment
without committing it, then explicitly choose one language:

```sh
node scripts/smoke-openai.mjs --allow-live --budget-tokens=1047608
uv run --locked python scripts/smoke_openai.py --allow-live --budget-tokens=1047608
```

Each command permits one synthetic request, at most 32 output tokens and 15
seconds, with cancellation through Ctrl-C. Running without the flags reports
`not_run` and exits 2 before reading a credential or connecting. The smoke prints
only status, model and scope; it never prints the key, backend error or raw answer.
It checks the adapter only; offline loop tests cover mediated authorization.
Account access and availability remain unverified until an operator runs it.

Streaming, parallel calls, built-in tools, multimodal input/output, custom URLs,
automatic retries, and completed-session scoped transcripts remain unsupported.
The adapter supports the initial buffered transcript used by buffered, durable,
refresh and redirect loops; this slice tests the buffered loop integration.
Full workflow conformance, streaming release (#44), mode composition (#45),
effectiveness and independent review remain separate gates.
