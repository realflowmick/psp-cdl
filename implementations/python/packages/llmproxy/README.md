# llmproxy

Provider-neutral model gateway and authoritative tool-dispatch loop.

Status: **experimental**. `BufferedLlmLoop` implements the opt-in PSP-LLM-LOOP-0.1 draft: signed prompt binding, pre-inference policy, read-only tool dispatch and buffered output authorization. `DurableLlmLoop` separately opts into PSP-LLM-DURABLE-0.1 for atomic turns/completion, explicit lockdown and currently authorized receipt recovery. See the root `docs/llm-loop.md`, `docs/llm-durable.md` and `examples/llm`. Live providers, streaming, scoped/redirect execution and automatic refresh remain unsupported. The whole-workflow guard still raises NOT_IMPLEMENTED. Package publication remains disabled.

License: Apache-2.0. Founding sponsor: RealflowCloud, Inc.
