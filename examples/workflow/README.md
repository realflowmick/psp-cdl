# Authenticated workflow example

After the repository's dependency setup and TypeScript build, run from the repository root:

```sh
node examples/workflow/workflow.mjs
uv run --locked python examples/workflow/workflow.py
```

Both examples use the same public libraries and HTTP handler: create a session, save progress, pause at a checkpoint, deny a premature resume, grant approval in the trusted host, resume and retry the acknowledgement. Expected output:

```json
{"created":1,"saved":2,"paused":3,"denied":"AUTHORIZATION_DENIED","resumed":4,"view":{"stage":"resumed"}}
```

Credentials and resume secrets are generated at runtime and never printed. Checkpoint tokens remain in the host callback's private map. The examples create disposable SQLite files and remove them on exit. All state is synthetic; the permissive storage callback is suitable only for this example. Real hosts must evaluate storage restrictions, authenticate real callers, enforce workflow rules, and release only permitted data through `present`.

The examples invoke the framework-neutral HTTP handler directly. Real mixed-language loopback HTTP and MCP stdio flows are exercised by `uv run --locked python scripts/check-workflow-parity.py`. See the [workflow API guide](../../docs/workflow-api.md) for contracts and host responsibilities. No SaaS account, database service, UI, or inference provider is required.
