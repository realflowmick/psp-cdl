# @psp-cdl/studio-server

Loopback Node backend for PSP Studio. It serves the browser app a JSON API and a
socket.io hub, runs live LLMProxy/MCPProxy scenarios in-process with the
development observer attached, spawns the existing Python evaluation engines and
tails their journals, edits `.psp` files in a workspace folder, and keeps LLM API
keys and the prompt-signing secret in a locally encrypted vault.

```sh
npm run build
node apps/studio-server/dist/main.js --workspace examples/in-context --data .artifacts/studio
```

Flags: `--port` (4810), `--host` (127.0.0.1 only unless `--allow-remote`),
`--workspace <dir of .psp files>`, `--data <state dir>`, `--inspect` (attach
model-visible payloads to events), `--cors <origin,origin>`, `--uv <path>`, `--web <built app dir>`.
`PSP_STUDIO_VAULT_PASSPHRASE` derives the vault key from a passphrase instead of
the generated key file. See [docs/studio.md](../../docs/studio.md).

Development tooling only: no security claim, no production readiness, not one of
the seven reference components. Apache-2.0; see the repository [LICENSE](../../LICENSE).
