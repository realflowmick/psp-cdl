# Local MCP mediation demonstration

After workspace setup and `npm run build`, run from the checkout root:

```sh
node examples/mediation/typescript.mjs
uv run --locked python examples/mediation/python.py
```

Each demonstration launches a real local MCP child with a public synthetic credential, performs initialization and discovery, then exercises a permitted call and a separately denied call through the proxy adapter. The permitted result contains level-5 provenance. The denied case records zero downstream tool calls. Temporary databases, spy files and child processes are cleaned up.

For complete three-process chains in both language directions, run `uv run --locked python scripts/check-mediation-parity.py`. These are bounded behavior demonstrations. The [integration guide](../../docs/mcp-stdio.md) describes the trusted launcher, approval, clock and cancellation contracts.
