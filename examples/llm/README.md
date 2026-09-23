# Buffered mock-provider loop

After the [development setup](../../docs/development.md), run from the root:

```sh
node examples/llm/buffered.mjs
uv run --locked python examples/llm/buffered.py
```

Both examples use the public synthetic host fixture: a signed prompt, temporary
SQLite session, local read-only tool, mock provider and host policy callbacks.
They show a successful two-inference/one-tool loop and a provider policy denial
with zero provider or tool calls. No live provider, real credential or paid API
is used. Temporary state is cleaned up. See the [library guide](../../docs/llm-loop.md)
for the contracts an application host must implement.
