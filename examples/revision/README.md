# Approved revision refresh

Run from the repository root after the [development setup](../../docs/development.md):

```sh
node examples/revision/refresh.mjs
uv run --locked python examples/revision/refresh.py
```

Both examples launch a synthetic revision-aware tool, call it through the dispatch gate, open a fresh tool-2 peer, approve its known fixture catalog and replace the gate registry. Output shows `tool-1 / registry-1` followed by `tool-2 / registry-2`. The tool-2 child uses host publication to replace its initial tool registration before accepting connections. Temporary SQLite state is removed afterward; no account, real credential or model is used.

Approvals are predetermined for these synthetic tools. Applications must obtain approval from their trusted host configuration or review workflow. See the [revision guide](../../docs/mcp-revision.md) for publication, authority, concurrency and restart requirements. This example does not implement a managed catalog or distributed refresh service.
