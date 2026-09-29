# Context/service round trips

These paired synthetic examples install both interpreter candidates and the full
application through `ContextLlmLoop`, persist a model-selected path, return a
denial for model handling, and checkpoint/resume a saved session. They use the
repository's public fixtures and actual SQLite workflow service. Providers are
scripted; no model account, credentials or paid calls are needed.

From the repository root after building:

```sh
node examples/in-context/service/run.mjs
uv run --locked python examples/in-context/service/run.py
```

Both examples emit the same compact observations. See the
[integration guide](../../../docs/context-service.md) for the host callbacks,
limits, failure recovery and model-behavior work still pending.
