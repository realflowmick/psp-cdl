// SPDX-License-Identifier: Apache-2.0
import { createServer, type Server } from "node:http";
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import type { EngineKind } from "@psp-cdl/studio-core";
import { buildApi } from "./http/api.js";
import { staticHandler } from "./http/static.js";
import { RealtimeHub } from "./realtime/hub.js";
import { RunManager } from "./runs/manager.js";
import { CollectionStore } from "./scenarios/store.js";
import { Vault } from "./secrets/vault.js";
import { Workspace } from "./workspace/files.js";
import { LiveLoopEngine } from "./engines/live-loop/index.js";
import { PythonEngine, uvLauncher, type Launcher } from "./engines/python.js";
import type { Engine, EngineServices } from "./engines/types.js";
import { AssistantService } from "./assistant/service.js";
import { APP_MIGRATIONS, MCPPROXY_MIGRATIONS, StudioDatabase } from "./db/database.js";
import { PipelineStore } from "./pipelines/store.js";
import { BaselineStore } from "./pipelines/backends.js";
import { PipelineRuntime, type ProviderFactory } from "./pipelines/runtime.js";

export interface StudioServerOptions {
  workspace: string;
  data: string;
  repoRoot: string;
  /** Enables model-visible payloads on request; off by default. */
  inspect?: boolean;
  corsOrigins?: readonly string[];
  vaultPassphrase?: string;
  uv?: string;
  /** Test hook: replaces the `uv run --locked python` launcher for the Python engines. */
  launcher?: Launcher;
  /** Test hook: restricts the registered engines. */
  engines?: readonly EngineKind[];
  /** Directory holding the built browser app; served at / when set. */
  web?: string;
  /** Test hook: replaces fetch for the authoring assistant's provider calls and Anthropic model calls. */
  fetch?: typeof fetch;
  /** Environment for pipeline pointers (env:PSP_DOC) and backend credentials; defaults to process.env. */
  env?: NodeJS.ProcessEnv;
  /** Test hook: supplies pipeline model providers. */
  pipelineProvider?: ProviderFactory;
}

export interface StudioServer {
  http: Server;
  hub: RealtimeHub;
  runs: RunManager;
  collections: CollectionStore;
  workspace: Workspace;
  vault: Vault;
  assistant: AssistantService;
  /** The application database (`<data>/studio.sqlite`). */
  database: StudioDatabase;
  pipelines: PipelineStore;
  pipelineRuntime: PipelineRuntime;
  listen(port: number, host: string): Promise<{ port: number; host: string }>;
  close(): Promise<void>;
}

const version = (): string => {
  try { return (createRequire(import.meta.url)("../package.json") as { version: string }).version; } catch { return "0.0.0"; }
};

/** Assembles the studio backend. Nothing listens until `listen` is called. */
export function createStudioServer(options: StudioServerOptions): StudioServer {
  const data = resolve(options.data), repoRoot = resolve(options.repoRoot);
  mkdirSync(data, { recursive: true });
  const vault = new Vault(data, options.vaultPassphrase);
  const workspace = new Workspace(options.workspace);
  const collections = new CollectionStore(data);
  const runs = new RunManager(data);
  const uv = options.uv ?? "uv";
  const services: EngineServices = { vault, workspace, repoRoot, uv, ...(options.fetch ? { fetch: options.fetch } : {}) };
  const launcher = options.launcher ?? uvLauncher(uv);
  const all: Engine[] = [new LiveLoopEngine() as Engine, ...(["campaign", "joint", "study", "heldout"] as const).map(kind => new PythonEngine(kind, launcher) as Engine)];
  const engines = new Map<EngineKind, Engine>(all.filter(e => !options.engines || options.engines.includes(e.kind)).map(e => [e.kind, e]));
  const corsOrigins = options.corsOrigins ?? [];
  const assistant = new AssistantService({ workspace, vault, repoRoot, ...(options.fetch ? { fetch: options.fetch } : {}) });
  const database = new StudioDatabase(join(data, "studio.sqlite"), APP_MIGRATIONS);
  const mcpState = new StudioDatabase(join(data, "mcpproxy-state.sqlite"), MCPPROXY_MIGRATIONS);
  const pipelines = new PipelineStore(database), baselines = new BaselineStore(mcpState);
  const env = options.env ?? process.env;
  const pipelineRuntime = new PipelineRuntime({ store: pipelines, baselines, services, dataDir: data, env, ...(options.pipelineProvider ? { provider: options.pipelineProvider } : {}) });
  const router = buildApi({ collections, runs, workspace, vault, engines, services, assistant, inspectAllowed: options.inspect === true, corsOrigins, version: version(), pipelines: { store: pipelines, runtime: pipelineRuntime, baselines, env } });
  const serveStatic = options.web ? staticHandler(options.web) : null;
  const http = createServer((req, res) => { if (serveStatic?.(req, res)) return; void router.handle(req, res); });
  http.requestTimeout = 120_000;
  const hub = new RealtimeHub(http, runs, corsOrigins);
  return {
    http, hub, runs, collections, workspace, vault, assistant, database, pipelines, pipelineRuntime,
    listen: (port, host) => new Promise((resolvePromise, reject) => {
      http.once("error", reject);
      http.listen(port, host, () => {
        http.off("error", reject);
        const address = http.address();
        resolvePromise({ port: typeof address === "object" && address ? address.port : port, host });
      });
    }),
    close: async () => {
      await hub.close();
      await pipelineRuntime.shutdown();
      await new Promise<void>(resolvePromise => http.close(() => resolvePromise()));
      database.close(); mcpState.close();
    }
  };
}
