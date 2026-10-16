// SPDX-License-Identifier: Apache-2.0
import type { IncomingMessage, ServerResponse } from "node:http";

export class StudioError extends Error {
  constructor(public readonly code: string, public readonly status = 400, message?: string) {
    super(message ?? code);
    this.name = "StudioError";
  }
}
export interface RouteContext {
  params: Record<string, string>;
  query: URLSearchParams;
  body: unknown;
  req: IncomingMessage;
  res: ServerResponse;
}
export type Handler = (ctx: RouteContext) => unknown | Promise<unknown>;
/** Return this from a handler to choose a status code. */
export class Reply { constructor(public readonly status: number, public readonly body: unknown) {} }
interface Route { method: string; parts: string[]; handler: Handler; maxBodyBytes: number; raw: boolean }
/** Overrides MAX_BODY_BYTES for one route, for example to accept attachments; `raw` hands the handler the body bytes unparsed. */
export interface RouteOptions { maxBodyBytes?: number; raw?: boolean }
export const MAX_BODY_BYTES = 4 * 1024 * 1024;

export function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "content-length": Buffer.byteLength(text), "cache-control": "no-store" });
  res.end(text);
}

/** A deliberately small JSON router: method and path matching, bounded bodies, CORS allow-list. */
export class Router {
  private readonly routes: Route[] = [];
  constructor(private readonly corsOrigins: readonly string[]) {}
  add(method: string, pattern: string, handler: Handler, options: RouteOptions = {}): this {
    this.routes.push({ method, parts: pattern.split("/").filter(Boolean), handler, maxBodyBytes: options.maxBodyBytes ?? MAX_BODY_BYTES, raw: options.raw === true });
    return this;
  }
  private static match(parts: string[], path: string[]): Record<string, string> | null {
    const params: Record<string, string> = {};
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i]!;
      if (p.startsWith("*")) { params[p.slice(1)] = path.slice(i).map(decodeURIComponent).join("/"); return params; }
      if (i >= path.length) return null;
      if (p.startsWith(":")) params[p.slice(1)] = decodeURIComponent(path[i]!);
      else if (p !== path[i]) return null;
    }
    return path.length === parts.length ? params : null;
  }
  /** Applies the allow-list; returns false when the request was answered with a denial. */
  cors(req: IncomingMessage, res: ServerResponse): boolean {
    const origin = req.headers.origin;
    if (origin === undefined) return true;
    if (!this.corsOrigins.includes(origin)) { sendJson(res, 403, { error: { code: "ORIGIN_DENIED", message: "Origin is not in the studio allow-list." } }); return false; }
    res.setHeader("access-control-allow-origin", origin);
    res.setHeader("vary", "Origin");
    res.setHeader("access-control-allow-methods", "GET,POST,PUT,DELETE,OPTIONS");
    res.setHeader("access-control-allow-headers", "content-type");
    res.setHeader("access-control-max-age", "600");
    return true;
  }
  private static readBody(req: IncomingMessage, limit: number, raw = false): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      let size = 0;
      req.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > limit) { reject(new StudioError("PAYLOAD_TOO_LARGE", 413)); req.removeAllListeners("data"); req.removeAllListeners("end"); req.resume(); return; }
        chunks.push(chunk);
      });
      req.on("end", () => {
        if (!size) { resolve(undefined); return; }
        if (raw) { resolve(Buffer.concat(chunks)); return; }
        try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))); }
        catch { reject(new StudioError("INVALID_JSON", 400, "Request body is not valid JSON.")); }
      });
      req.on("error", () => reject(new StudioError("REQUEST_ABORTED", 400)));
    });
  }
  async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      if (!this.cors(req, res)) return;
      if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }
      const url = new URL(req.url ?? "/", "http://studio.local");
      const path = url.pathname.split("/").filter(Boolean);
      let allowed = false;
      for (const route of this.routes) {
        const params = Router.match(route.parts, path);
        if (params === null) continue;
        allowed = true;
        if (route.method !== req.method) continue;
        const body = ["POST", "PUT", "PATCH", "DELETE"].includes(req.method ?? "") ? await Router.readBody(req, route.maxBodyBytes, route.raw) : undefined;
        const result = await route.handler({ params, query: url.searchParams, body, req, res });
        if (res.writableEnded) return;
        if (result === undefined) { res.writeHead(204); res.end(); return; }
        if (result instanceof Reply) { sendJson(res, result.status, result.body); return; }
        sendJson(res, 200, result);
        return;
      }
      sendJson(res, allowed ? 405 : 404, { error: { code: allowed ? "METHOD_NOT_ALLOWED" : "NOT_FOUND" } });
    } catch (e) {
      if (res.writableEnded) return;
      if (e instanceof StudioError) { sendJson(res, e.status, { error: { code: e.code, message: e.message } }); return; }
      const code = typeof (e as { code?: unknown })?.code === "string" ? (e as { code: string }).code : "INTERNAL_ERROR";
      sendJson(res, 500, { error: { code, message: "The studio server could not complete the request." } });
    }
  }
}
