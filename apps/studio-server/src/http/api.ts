// SPDX-License-Identifier: Apache-2.0
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ENGINE_KINDS, STUDIO_PROFILE, isIdentifier, type EngineKind, type PreparedRun, type RunRecord, type Scenario } from "@psp-cdl/studio-core";
import { Reply, Router, StudioError, type RouteContext } from "./router.js";
import type { CollectionStore } from "../scenarios/store.js";
import type { RunManager } from "../runs/manager.js";
import type { Workspace } from "../workspace/files.js";
import { SECRET_NAMES, type SecretName, type Vault } from "../secrets/vault.js";
import type { Engine, EngineServices } from "../engines/types.js";
import type { AssistantService } from "../assistant/service.js";
import { interpreters, pack, unpack } from "../psp/files.js";
import { addPipelineRoutes, type PipelineApiOptions } from "./pipelines.js";

/** Attachments arrive base64 encoded: 20 MiB of files plus encoding overhead and the prompt. */
const ASSISTANT_BODY_BYTES = 32 * 1024 * 1024;

export interface ApiOptions {
  collections: CollectionStore;
  runs: RunManager;
  workspace: Workspace;
  vault: Vault;
  engines: ReadonlyMap<EngineKind, Engine>;
  services: EngineServices;
  assistant: AssistantService;
  /** Pipeline configurations, their sessions and MCPProxy state. */
  pipelines?: Omit<PipelineApiOptions, "services">;
  /** Server-wide switch; a run can only attach model-visible payloads when this is on. */
  inspectAllowed: boolean;
  corsOrigins: readonly string[];
  version: string;
}

const body = (ctx: RouteContext): Record<string, unknown> => {
  if (ctx.body === undefined) throw new StudioError("INVALID_REQUEST", 400, "A JSON body is required.");
  if (typeof ctx.body !== "object" || ctx.body === null || Array.isArray(ctx.body)) throw new StudioError("INVALID_REQUEST", 400, "The body must be a JSON object.");
  return ctx.body as Record<string, unknown>;
};
const text = (value: unknown, field: string, max = 200): string => {
  if (typeof value !== "string" || !value.length || value.length > max) throw new StudioError("INVALID_REQUEST", 400, `${field} must be a string of at most ${max} characters.`);
  return value;
};
const isSecretName = (v: unknown): v is SecretName => typeof v === "string" && (SECRET_NAMES as readonly string[]).includes(v);

/** JSON API used by the browser app. Every handler validates its input before touching state. */
export function buildApi(options: ApiOptions): Router {
  const { collections, runs, workspace, vault, engines, services, assistant } = options;
  const router = new Router(options.corsOrigins);
  const locate = (ctx: RouteContext): { scenario: Scenario; collectionId: string } => {
    const input = body(ctx);
    const collectionId = text(input.collectionId, "collectionId", 64), scenarioId = text(input.scenarioId, "scenarioId", 64);
    if (!isIdentifier(collectionId) || !isIdentifier(scenarioId)) throw new StudioError("INVALID_IDENTIFIER", 400);
    return { scenario: collections.scenario(collectionId, scenarioId), collectionId };
  };
  const engineFor = (scenario: Scenario): Engine => {
    const engine = engines.get(scenario.kind);
    if (!engine) throw new StudioError("UNSUPPORTED_ENGINE", 501, `No engine is registered for ${scenario.kind}.`);
    return engine;
  };

  router.add("GET", "/api/status", () => ({
    profile: STUDIO_PROFILE, version: options.version, engines: [...engines.keys()], supportedEngines: [...ENGINE_KINDS],
    inspectAllowed: options.inspectAllowed, workspace: workspace.root, activeRuns: runs.active(), vault: { mode: vault.mode, signing: vault.describeSigning() },
    notice: "PSP Studio is development tooling. It asserts no security property and is not one of the reference components."
  }));

  /** Starting points for new scenarios, read from the repository's own example and vector files. */
  router.add("GET", "/api/templates", () => {
    const read = (rel: string): unknown => { try { return JSON.parse(readFileSync(join(services.repoRoot, rel), "utf8")); } catch { return null; } };
    const campaign = read("evaluation/campaign-config.example.json");
    const joint = read("conformance/vectors/llm/interpreter-validation-0.1.json") as { cases?: { id?: unknown }[] } | null;
    return {
      campaignConfig: campaign && typeof campaign === "object" && !Array.isArray(campaign) ? campaign : null,
      heldout: { plan: "conformance/vectors/evaluation/heldout-request-0.1.json", corpus: "conformance/vectors/evaluation/heldout-corpus-0.1.json" },
      jointCaseIds: Array.isArray(joint?.cases) ? joint!.cases.map(c => c.id).filter((id): id is string => typeof id === "string") : [],
      studyConditions: ["unprotected", "psp-only", "cdl-only", "combined"],
      languages: ["typescript", "python"]
    };
  });
  router.add("GET", "/api/collections", () => ({ collections: collections.list() }));
  router.add("GET", "/api/collections/:id", ctx => collections.get(ctx.params.id!));
  router.add("PUT", "/api/collections/:id", ctx => {
    const input = body(ctx);
    if (input.id !== ctx.params.id) throw new StudioError("INVALID_REQUEST", 400, "The body id must match the path.");
    return collections.put(input);
  });
  router.add("DELETE", "/api/collections/:id", ctx => { collections.delete(ctx.params.id!); return undefined; });

  router.add("GET", "/api/workspace/files", () => ({ root: workspace.root, files: workspace.list() }));
  router.add("GET", "/api/workspace/files/*path", ctx => workspace.read(ctx.params.path!));
  router.add("PUT", "/api/workspace/files/*path", ctx => workspace.write(ctx.params.path!, body(ctx).text));

  router.add("GET", "/api/secrets", () => ({ mode: vault.mode, secrets: vault.list(), signing: vault.describeSigning() }));
  router.add("PUT", "/api/secrets/:name", ctx => {
    if (!isSecretName(ctx.params.name)) throw new StudioError("UNKNOWN_SECRET", 404);
    return vault.set(ctx.params.name, body(ctx).value as string);
  });
  router.add("DELETE", "/api/secrets/:name", ctx => {
    if (!isSecretName(ctx.params.name)) throw new StudioError("UNKNOWN_SECRET", 404);
    vault.delete(ctx.params.name); return undefined;
  });
  router.add("POST", "/api/secrets/signing/generate", ctx => {
    const input = body(ctx);
    return vault.generateSigning(input.algorithm as "hmac-sha256" | "ed25519", text(input.keyId, "keyId", 64));
  });

  // PSPX: the interpreter system prompt and an application in one file (see studio-core pspx.ts).
  router.add("GET", "/api/pspx/interpreters", () => ({ interpreters: interpreters(services.repoRoot) }));
  router.add("POST", "/api/pspx/pack", ctx => {
    const input = body(ctx);
    if (typeof input.application !== "string") throw new StudioError("INVALID_REQUEST", 400, "application must be PSP text.");
    if (input.system !== undefined && typeof input.system !== "string") throw new StudioError("INVALID_REQUEST", 400, "system must be text.");
    if (input.interpreter !== undefined && typeof input.interpreter !== "string") throw new StudioError("INVALID_REQUEST", 400, "interpreter must be an id.");
    return pack(services.repoRoot, {
      application: input.application, name: text(input.name, "name", 512),
      ...(typeof input.interpreter === "string" ? { interpreter: input.interpreter } : {}), ...(typeof input.system === "string" ? { system: input.system } : {})
    });
  });
  router.add("POST", "/api/pspx/unpack", ctx => {
    const input = body(ctx);
    if (typeof input.text !== "string") throw new StudioError("INVALID_REQUEST", 400, "text must be PSPX text.");
    return unpack(input.text);
  });

  // Authoring assistant. Provider keys stay in the vault; requests run in the background and are polled.
  router.add("GET", "/api/assistant/providers", () => ({ providers: assistant.providers() }));
  router.add("GET", "/api/assistant/requests", ctx => ({ requests: assistant.list(ctx.query.get("path") ?? undefined) }));
  router.add("POST", "/api/assistant/requests", ctx => new Reply(202, assistant.start(body(ctx))), { maxBodyBytes: ASSISTANT_BODY_BYTES });
  router.add("GET", "/api/assistant/requests/:id", ctx => assistant.get(ctx.params.id!));
  router.add("POST", "/api/assistant/requests/:id/accept", ctx => assistant.accept(ctx.params.id!, (ctx.body as { force?: unknown } | undefined)?.force === true));
  router.add("POST", "/api/assistant/requests/:id/reject", ctx => assistant.reject(ctx.params.id!));
  router.add("POST", "/api/assistant/requests/:id/cancel", ctx => assistant.cancel(ctx.params.id!));

  if (options.pipelines) addPipelineRoutes(router, { ...options.pipelines, services });

  router.add("GET", "/api/runs", () => ({ runs: runs.list() }));
  router.add("GET", "/api/runs/:id", ctx => runs.get(ctx.params.id!));
  router.add("GET", "/api/runs/:id/events", ctx => {
    const from = Number(ctx.query.get("from") ?? "1"), limit = Number(ctx.query.get("limit") ?? "10000");
    if (!Number.isSafeInteger(from) || from < 1 || !Number.isSafeInteger(limit) || limit < 1 || limit > 50_000) throw new StudioError("INVALID_REQUEST", 400, "from and limit must be positive integers.");
    const events = runs.events(ctx.params.id!, from, limit);
    return { runId: ctx.params.id, events, next: events.length ? events[events.length - 1]!.seq + 1 : from };
  });
  router.add("POST", "/api/runs/:id/cancel", ctx => runs.cancel(ctx.params.id!));

  router.add("POST", "/api/runs/prepare", async (ctx): Promise<PreparedRun> => {
    const { scenario } = locate(ctx);
    return engineFor(scenario).prepare(scenario, { ...services, inspectAllowed: options.inspectAllowed });
  });
  router.add("POST", "/api/runs", async (ctx): Promise<Reply> => {
    const input = body(ctx), { scenario, collectionId } = locate(ctx);
    const engine = engineFor(scenario);
    const inspect = input.inspect === true;
    if (inspect && !options.inspectAllowed) throw new StudioError("INSPECT_DISABLED", 403, "Start the server with --inspect to attach model-visible payloads.");
    if (input.admissionDigest !== undefined && typeof input.admissionDigest !== "string") throw new StudioError("INVALID_REQUEST", 400, "admissionDigest must be a string.");
    if (runs.active() >= 4) throw new StudioError("TOO_MANY_RUNS", 429, "At most four runs may be active at once.");
    const record: RunRecord = runs.create({ engine: scenario.kind, scenarioId: scenario.id, collectionId, label: typeof input.label === "string" && input.label.length <= 200 ? input.label : scenario.label, inspect });
    const admissionDigest = input.admissionDigest as string | undefined;
    // Fire and forget: the record and journal carry the outcome; clients follow it over the socket.
    void runs.execute(record.runId, handle => engine.run(scenario, { ...services, ...handle, ...(admissionDigest !== undefined ? { admissionDigest } : {}) }));
    return new Reply(202, runs.get(record.runId));
  });
  return router;
}
