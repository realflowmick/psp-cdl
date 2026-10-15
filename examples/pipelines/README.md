# Pipeline examples

`.pspp` files are PSP Studio pipeline configurations: the services a PSP runs on and how
they are wired, as JSON with `"$format": "pspp/1"`. Import them on the studio's
Pipelines page or with `POST /api/pipelines/import`. They are development tooling and
assert no security property. See [docs/studio.md](../../docs/studio.md#pipelines).

| File | What it shows |
| --- | --- |
| `evaluator-ring.pspp` | The design handoff's worked example in canonical form. It has a chat Initiator, an LLMProxy with three request and three response filters, a Model, one MCPProxy, a vector store and a logger tap. The PSP is referenced as `env:PSP_DOC` and signed on retrieval. Exporting it after an import reproduces the file byte for byte. |

The example names `claude-sonnet-4-6`. The reference loop has no TypeScript Anthropic
adapter, so its turns end with `UNSUPPORTED_PROVIDER`. To run it, set `provider` to
`openai` (with a vault key) or to `mock` with a `script`. The MCPProxy also needs
`serverInfo` and `auth: env:NAME` before it can connect to a backend. Validate lists
both.
