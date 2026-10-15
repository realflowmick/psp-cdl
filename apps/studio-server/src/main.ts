#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
import { parseArgs } from "node:util";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createStudioServer } from "./server.js";

const { values } = parseArgs({
  options: {
    port: { type: "string", default: "4810" },
    host: { type: "string", default: "127.0.0.1" },
    "allow-remote": { type: "boolean", default: false },
    workspace: { type: "string", default: "examples/in-context" },
    data: { type: "string", default: ".artifacts/studio" },
    inspect: { type: "boolean", default: false },
    cors: { type: "string", default: "" },
    uv: { type: "string", default: "uv" },
    repo: { type: "string" },
    web: { type: "string" },
    help: { type: "boolean", default: false }
  },
  strict: true
});

if (values.help) {
  console.log(`psp-studio-server [--port 4810] [--host 127.0.0.1] [--allow-remote] [--workspace <dir>] [--data <dir>] [--inspect] [--cors origin,origin] [--uv <path>] [--repo <dir>] [--web <built app dir>]
Development tooling only. PSP_STUDIO_VAULT_PASSPHRASE derives the vault key from a passphrase instead of vault.key.`);
  process.exit(0);
}

const host = values.host!;
if (!["127.0.0.1", "localhost", "::1"].includes(host) && !values["allow-remote"]) {
  console.error("Refusing to bind a non-loopback host without --allow-remote. The studio holds API keys and runs model calls.");
  process.exit(2);
}
const port = Number(values.port);
if (!Number.isInteger(port) || port < 0 || port > 65535) { console.error("--port must be an integer between 0 and 65535."); process.exit(2); }

const repoRoot = values.repo ? resolve(values.repo) : resolve(fileURLToPath(new URL("../../../", import.meta.url)));
if (!existsSync(resolve(repoRoot, "package.json"))) { console.error(`Repository root ${repoRoot} has no package.json; pass --repo.`); process.exit(2); }

const server = createStudioServer({
  workspace: resolve(repoRoot, values.workspace!), data: resolve(repoRoot, values.data!), repoRoot, inspect: values.inspect,
  corsOrigins: values.cors!.split(",").map(s => s.trim()).filter(Boolean), uv: values.uv!,
  ...(values.web ? { web: resolve(repoRoot, values.web) } : {}),
  ...(process.env.PSP_STUDIO_VAULT_PASSPHRASE ? { vaultPassphrase: process.env.PSP_STUDIO_VAULT_PASSPHRASE } : {})
});
const bound = await server.listen(port, host);
console.log(JSON.stringify({ studio: `http://${bound.host}:${bound.port}`, workspace: server.workspace.root, inspect: values.inspect, vault: server.vault.mode, notice: "Development tooling; no security claim." }));
let closing = false;
const shutdown = () => {
  if (closing) return; closing = true;
  console.error("Stopping the studio server.");
  void server.close().then(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000).unref();
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
