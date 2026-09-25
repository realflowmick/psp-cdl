# PSP OpenAI Chat Adapter 0.1

Status: project draft, experimental opt-in adapter. This extends the provider
boundary of PSP-LLM-LOOP-0.1 without changing published RFCs. Basis: PSP Core
3.2.0 §§17.3–17.4, 21.2–21.4 and CDL 1.5 §§7.1–7.6. Full M5 completion,
streaming, attention isolation and effectiveness claims remain outside scope.

## Pinned provider and authority

The sole live endpoint is `https://api.openai.com/v1/chat/completions`, with
model `gpt-4.1-mini-2025-04-14`. The API has no dated version header; this draft
pins the `/v1` route, model snapshot and the mapping below. The host approves
registration `openai-chat` / `chat-v1-gpt-4.1-mini-2025-04-14-psp-0.1` in the
existing signed prompt and authority snapshot. Offline registrations use the
different ID `openai-chat-offline`. Switching mode requires fresh host approval.

The factory returns the existing `{id, revision, sources, complete, invoke}`
registration. The host supplies authenticated, complete transitive capability
sources, including its actual provider account, retention, logging and network
path. The adapter does not infer capabilities from vendor/model names or from
`store: false`. Credential, clock and budget configuration remain in a closure.
No tenant, session, policy binding, key, credential or provider response metadata
is added to model messages. Hosts must route registrations to the correct owner;
the unchanged loop authenticates and checks session ownership before invocation.

## Request and response mapping

Only the loop's bounded `{messages, tools}` request is admitted. System/user text
retains its role. Tool definitions (at most 128) are sorted by original name and
mapped to `psp_tool_0`, `psp_tool_1`, etc.; descriptions contain the original name
and parameters contain the approved input schema. This preserves namespaced
names that the provider's function-name syntax cannot represent. Output schemas
remain enforced by the dispatch gate. Unknown or duplicate tools reject.

An assistant tool call followed by its matching tool result becomes one
`tool_calls` function entry and one `tool` message. IDs `psp_call_0`, etc. are
reconstructed per transcript; provider-supplied IDs are validated and discarded.
Arguments and tool-result objects use canonical JSON. Orphan results, incomplete
pairs, extra fields, additional system messages and multimodal content reject.
There is no retained conversation, call-ID map or provider conversation handle.

Requests fix `stream: false`, `n: 1`, `store: false`, and
`max_completion_tokens` to the host limit. With tools they also fix
`parallel_tool_calls: false` and `tool_choice: "auto"`. No caller-supplied
provider parameters, URLs, headers, model overrides or built-in tools are accepted.

Accept only a JSON `chat.completion` for the exact model with one index-zero
choice and valid usage. `stop` with string content and no calls maps to
`{type: "final", text}`. `tool_calls` with exactly one known function, object
arguments and null/empty content maps to `{type: "tool", name, arguments}`.
Refusals, nonempty annotations, audio, legacy function calls, unknown response
fields, streams, multiple choices/calls, mixed text/calls, truncation (`length`),
content filtering, duplicate JSON keys and malformed UTF-8/JSON reject. The
core JSON structural and number limits apply. No response metadata becomes
authority or model-visible evidence.

## Opt-in, bounds and budget

Live construction requires `mode: "live"`, `allowLive: true`, an explicitly
supplied nonempty API key, capability sources, a clock returning integer Unix
seconds, and all limits. Imports and offline factories never look up credentials
or connect. Offline mode requires an explicit fake transport and prohibits keys
and live opt-in. Live mode prohibits replacement transports. No implicit proxy,
redirect, retry, compression, custom endpoint or TLS-verification override exists.

Limits are positive safe integers: request/response bytes (at most 1 MiB each),
output tokens (at most 32,768), calls (at most 32), total token reservation budget,
and wall-clock timeout (at most 120,000 ms). Each call also requires a host deadline
in the same seconds clock and a boolean cancellation callback. Native HTTP
header/parser bounds apply in addition to the body limit. The body is bounded as
it is read, and no bytes are exposed before complete decoding and validation.

Without a tokenizer or trustworthy pre-call usage, admission conservatively
reserves **1,047,576 input tokens plus the configured output-token limit per
attempt**, using the pinned model's full context allowance for input. Reservations
and call counts are charged before transport and never refunded, including on
errors, cancellation and malformed responses. Reported usage must be nonnegative
integers, sum correctly, and stay within these bounds; it never replenishes the
budget. This intentionally over-reserves. The ceiling is in tokens, not dollars;
hosts must separately account for their prices, account limits and other clients.
One registration admits one pending call; budgets are process-local and reset
only by explicit host reconstruction. Distributed/account-wide budgets are host
responsibilities. Request-byte bounds and call/output limits also constrain work.

Cancellation and the earlier of host deadline and monotonic wall timeout suppress
output and close live I/O. Python uses a daemon I/O worker; DNS resolution may
outlive the caller, but a cancelled worker must not submit a request after connect.
An already submitted request may still execute and be billed remotely. Offline
callbacks must be cooperative and are not a sandbox for untrusted code.

## Errors and verification

Adapter errors contain stable codes only: `INVALID_CONFIGURATION`,
`INVALID_REQUEST`, `INVALID_RESPONSE`, `REQUEST_TOO_LARGE`, `RESPONSE_TOO_LARGE`,
`BUDGET_EXHAUSTED`, `PROVIDER_BUSY`, `CANCELLED`, `DEADLINE_EXCEEDED`,
`PROVIDER_HTTP_ERROR`, `PROVIDER_FAILED`, or `HOST_ERROR`. The loop retains its
existing public error mapping (adapter failures become `PROVIDER_FAILED`, unless
its own deadline/cancellation checks apply). Never attach backend exceptions,
headers, bodies or credentials as an error cause. No automatic retries occur.

Shared offline vectors exercise mapping, admission, output suppression and
unchanged loop boundaries, including owner isolation and stale prompts. A
separately invoked synthetic live smoke command requires explicit opt-in, supplied
credentials and budget. An unrun live smoke is **not run**, never passed. This
draft does not authorize a paid run or establish provider-account availability.

Official API basis (checked 2026-09-24): [Chat Completions](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create)
and [GPT-4.1 mini snapshot/limits](https://developers.openai.com/api/docs/models/gpt-4.1-mini).

Dedicated to the public domain under CC0 1.0 Universal; see
[license](../../LICENSES/CC0-1.0.txt).
