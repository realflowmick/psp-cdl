// SPDX-License-Identifier: Apache-2.0
import { pipelineJsonSchema, validatePipeline, checkConfig, PipelineFormatError, type PipelineConfig, type TraceEntry } from "@psp-cdl/studio-core";
import { Reply, StudioError, type RouteContext, type Router } from "./router.js";
import type { PipelineStore } from "../pipelines/store.js";
import type { PipelineRuntime, TurnInput } from "../pipelines/runtime.js";
import { checkDrift, rebaseline, storedDrift, type BaselineStore } from "../pipelines/backends.js";
import { pspResolution } from "../pipelines/psp.js";
import type { EngineServices } from "../engines/types.js";

const IMPORT_BYTES = 2 * 1024 * 1024;
export interface PipelineApiOptions { store: PipelineStore; runtime: PipelineRuntime; baselines: BaselineStore; services: EngineServices; env?: NodeJS.ProcessEnv }

const object = (ctx: RouteContext): Record<string, unknown> => {
  if (!ctx.body || typeof ctx.body !== "object" || Array.isArray(ctx.body)) throw new StudioError("INVALID_REQUEST", 400, "The body must be a JSON object.");
  return ctx.body as Record<string, unknown>;
};
/** The text of an uploaded `.pspp`: a raw JSON body, or the first file part of multipart/form-data. */
export function uploadedText(body: unknown, contentType: string | undefined): string {
  if (!Buffer.isBuffer(body) || !body.length) throw new StudioError("INVALID_REQUEST", 400, "Send the .pspp file as the body, or as a multipart file part.");
  const type = (contentType ?? "").toLowerCase();
  if (!type.startsWith("multipart/form-data")) return body.toString("utf8");
  const boundary = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType ?? "");
  if (!boundary) throw new StudioError("INVALID_REQUEST", 400, "The multipart body has no boundary.");
  const delimiter = Buffer.from(`--${boundary[1] ?? boundary[2]!.trim()}`);
  let start = body.indexOf(delimiter);
  while (start >= 0) {
    const next = body.indexOf(delimiter, start + delimiter.length);
    if (next < 0) break;
    const part = body.subarray(start + delimiter.length, next);
    const split = part.indexOf("\r\n\r\n");
    if (split >= 0) {
      const headers = part.subarray(0, split).toString("utf8");
      if (/content-disposition:[^\r\n]*filename=/i.test(headers) || /name="file"/i.test(headers)) return part.subarray(split + 4, part.length - 2).toString("utf8");
    }
    start = next;
  }
  throw new StudioError("INVALID_REQUEST", 400, "The multipart body has no file part.");
}
const configOf = (value: unknown): PipelineConfig => {
  try { return checkConfig(value); }
  catch (e) { if (e instanceof PipelineFormatError) throw new StudioError("INVALID_PIPELINE", 400, [e.message, ...e.issues].join(" ")); throw e; }
};

/** `/api/pipelines`: the entity, import and export, validation, sessions and turns, vector and drift status. Literal paths come before `:id`. */
export function addPipelineRoutes(router: Router, options: PipelineApiOptions): void {
  const { store, runtime, baselines, services } = options;
  const proxyOf = (ctx: RouteContext) => {
    const pipelineId = ctx.query.get("pipeline");
    if (!pipelineId) throw new StudioError("INVALID_REQUEST", 400, "Name the pipeline with ?pipeline=<id>.");
    const proxy = store.get(pipelineId).config.components.find(c => c.id === ctx.params.proxyId && c.kind === "mcpproxy");
    if (!proxy) throw new StudioError("NOT_FOUND", 404, "No such MCPProxy in this pipeline.");
    return { pipelineId, proxy };
  };

  router.add("GET", "/api/pipelines", () => ({ pipelines: store.list() }));
  router.add("POST", "/api/pipelines", ctx => new Reply(201, store.create(object(ctx))));
  router.add("GET", "/api/pipelines/schema", () => pipelineJsonSchema());
  router.add("POST", "/api/pipelines/validate", ctx => {
    const input = object(ctx);
    const id = typeof input.id === "string" ? input.id : undefined;
    const config = (input.config ?? input) as PipelineConfig;
    if (!config || typeof config !== "object" || !Array.isArray((config as { components?: unknown }).components)) throw new StudioError("INVALID_REQUEST", 400, "Send a pipeline configuration, or {config, id}.");
    const env = runtime.validationEnv(config, id);
    return { problems: validatePipeline(config, env), env };
  });
  router.add("POST", "/api/pipelines/import", ctx => {
    const result = store.import(uploadedText(ctx.body, ctx.req.headers["content-type"]), ctx.query.get("onConflict") ?? undefined, ctx.query.get("name") ?? undefined);
    return new Reply(result.created ? 201 : 200, result);
  }, { raw: true, maxBodyBytes: IMPORT_BYTES });
  router.add("GET", "/api/pipelines/psp", ctx => {
    const ref = ctx.query.get("ref");
    if (!ref) throw new StudioError("INVALID_REQUEST", 400, "Name the document with ?ref=.");
    return pspResolution(ref, services.workspace, services.vault, options.env);
  });
  router.add("GET", "/api/pipelines/vectors/:storeId", ctx => {
    const pipelineId = ctx.query.get("pipeline");
    if (!pipelineId) throw new StudioError("INVALID_REQUEST", 400, "Name the pipeline with ?pipeline=<id>.");
    return runtime.vectorStatus(pipelineId, ctx.params.storeId!);
  });
  router.add("GET", "/api/pipelines/mcp/:proxyId/drift", async ctx => {
    const { pipelineId, proxy } = proxyOf(ctx);
    if (ctx.query.get("live") === "0") return storedDrift(baselines, pipelineId, proxy);
    return checkDrift(baselines, pipelineId, proxy, { env: n => (options.env ?? process.env)[n] });
  });
  router.add("POST", "/api/pipelines/mcp/:proxyId/rebaseline", async ctx => {
    const { pipelineId, proxy } = proxyOf(ctx);
    const note = typeof (ctx.body as { note?: unknown } | undefined)?.note === "string" ? String((ctx.body as { note: string }).note).slice(0, 500) : null;
    return rebaseline(baselines, pipelineId, proxy, note, { env: n => (options.env ?? process.env)[n] });
  });

  router.add("GET", "/api/pipelines/:id", ctx => {
    const row = store.get(ctx.params.id!);
    return { ...row, problems: validatePipeline(row.config, runtime.validationEnv(row.config, row.id)), sessions: runtime.list(row.id) };
  });
  router.add("PUT", "/api/pipelines/:id", ctx => {
    const input = object(ctx);
    return store.update(ctx.params.id!, configOf(input.config ?? input), input.version);
  });
  router.add("DELETE", "/api/pipelines/:id", ctx => {
    if (runtime.hasLive(ctx.params.id!)) throw new StudioError("SESSION_LIVE", 409, "End the pipeline's live sessions before deleting it.");
    store.delete(ctx.params.id!);
    baselines.clear(ctx.params.id!);
    return undefined;
  });
  router.add("POST", "/api/pipelines/:id/duplicate", ctx => new Reply(201, store.duplicate(ctx.params.id!)));
  router.add("GET", "/api/pipelines/:id/export", ctx => {
    const { fileName, text } = store.export(ctx.params.id!);
    ctx.res.writeHead(200, {
      "content-type": "application/json; charset=utf-8", "content-length": Buffer.byteLength(text), "cache-control": "no-store",
      "content-disposition": `attachment; filename="${fileName.replace(/["\\\r\n]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(fileName)}`
    });
    ctx.res.end(text);
    return undefined;
  });
  router.add("GET", "/api/pipelines/:id/queue", ctx => runtime.queue(ctx.params.id!));
  router.add("GET", "/api/pipelines/:id/session", ctx => ({ sessions: runtime.list(ctx.params.id!) }));
  router.add("POST", "/api/pipelines/:id/session", async ctx => new Reply(201, await runtime.start(ctx.params.id!)));
  router.add("DELETE", "/api/pipelines/:id/session/:sid", async ctx => { await runtime.context(ctx.params.id!, ctx.params.sid!); await runtime.close(ctx.params.sid!); return undefined; });
  router.add("GET", "/api/pipelines/:id/session/:sid/context", ctx => runtime.context(ctx.params.id!, ctx.params.sid!));
  router.add("POST", "/api/pipelines/:id/session/:sid/turn", async ctx => {
    const input = object(ctx) as TurnInput;
    if (!/text\/event-stream/.test(ctx.req.headers.accept ?? "")) return runtime.turn(ctx.params.id!, ctx.params.sid!, input);
    // Server-sent events: trace entries as they happen, then the run record.
    const res = ctx.res;
    const send = (event: string, data: unknown) => { if (!res.writableEnded) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); };
    let started = false;
    const start = () => { if (started) return; started = true; res.writeHead(200, { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-store", connection: "keep-alive" }); };
    try {
      const record = await runtime.turn(ctx.params.id!, ctx.params.sid!, input, (entry: TraceEntry) => { start(); send("trace", entry); });
      start(); send("record", record);
    } catch (e) {
      if (!started) throw e;
      send("error", { code: (e as { code?: string }).code ?? "TURN_FAILED", message: (e as Error).message });
    }
    res.end();
    return undefined;
  }, { maxBodyBytes: 4 * 1024 * 1024 });
}
