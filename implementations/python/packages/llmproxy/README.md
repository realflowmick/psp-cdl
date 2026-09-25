# llmproxy

Provider-neutral model gateway and authoritative tool-dispatch loop.

Status: **experimental**. `BufferedLlmLoop` implements the opt-in PSP-LLM-LOOP-0.1 draft: signed prompt binding, pre-inference policy, read-only tool dispatch and buffered output authorization. `DurableLlmLoop` separately opts into PSP-LLM-DURABLE-0.1 for atomic turns/completion, explicit lockdown and currently authorized receipt recovery. `RefreshingLlmLoop` opts into PSP-PROMPT-REFRESH-0.1 for host-approved expiration/interval refresh and durable version/counter metadata. See the root `docs/llm-loop.md`, `docs/llm-durable.md`, `docs/llm-refresh.md` and `examples/llm`. Streaming, scoped tools, combined refresh/redirect and other refresh modes remain unsupported. The whole-workflow guard still raises NOT_IMPLEMENTED. Package publication remains disabled.

License: Apache-2.0. Founding sponsor: RealflowCloud, Inc.

`RedirectingLlmLoop` adds opt-in atomic completion handoff. See [the redirect guide](../../../../docs/llm-redirect.md) for host approval, retained CDL evidence, recovery and unsupported modes.

`ScopedLlmLoop` adds opt-in post-completion conversation with replacement signed SYSTEM text, host boundary decisions and durable threat/violation receipts. See [the scoped guide](../../../../docs/llm-scoped.md).

The opt-in [OpenAI Chat adapter](../../../../docs/llm-provider.md) provides bounded buffered requests with explicit credentials, budget, deadlines and cancellation. Offline tests make no paid requests; the separate live smoke has not run. Completed-session scoped transcripts remain unsupported by this adapter.
