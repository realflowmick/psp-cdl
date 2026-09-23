# Local Streamable HTTP examples

After the repository development setup and TypeScript build, run from the repository root:

```sh
node examples/http/demo.mjs
uv run --locked python examples/http/demo.py
```

Each example starts a synthetic loopback HTTP server, acquires a pinned client with a separate public test credential, creates a SQLite workflow and dispatches `echo.read` through the gate. The server sends finite SSE; the client buffers it, validates the structured response and returns local level-5 provenance. Temporary files, transport sessions, child processes and connections are cleaned up on completion.

These examples reuse [test fixtures](../../scripts/http-fixtures.mjs). Their fixed credentials, permissive synthetic policy and plaintext loopback mode are for demonstration. The [HTTP integration guide](../../docs/mcp-http.md) explains resource-audience validation, TLS, request-local Python SQLite ownership, cancellation and the boundary between host-obtained tokens and OAuth client flows. For both mixed-language directions, negative TLS cases and complete HTTP proxy chains, run `python scripts/check-http-parity.py` after building.
