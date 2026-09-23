# Local dispatch demonstration

After workspace setup and `npm run build`, run either example from the repository root:

```sh
node examples/dispatch/typescript.mjs
uv run --locked python examples/dispatch/python.py
```

Each uses a temporary SQLite store, the repository's shared synthetic host, an authenticated local registry and a read-only echo callback. It lists tools for the active node, runs one permitted call, then denies a second call through CDL. The downstream count stays at one. No network endpoint, model provider, commercial service or real credential is used. Temporary state is removed on exit.

The [integration guide](../../docs/mcp-dispatch.md) explains the production host responsibilities and unsupported cases; these examples are behavior demonstrations, not deployment templates.
