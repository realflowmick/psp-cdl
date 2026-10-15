// SPDX-License-Identifier: Apache-2.0
import { createReadStream, existsSync, statSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { extname, relative, resolve, sep } from "node:path";

const TYPES: Record<string, string> = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".map": "application/json", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon", ".woff2": "font/woff2" };

/**
 * Serves a built browser bundle next to the API. Unknown paths fall back to index.html so the
 * single-page app owns its routes; anything under /api or the socket path never reaches here.
 */
export function staticHandler(dir: string): (req: IncomingMessage, res: ServerResponse) => boolean {
  const root = resolve(dir), index = resolve(root, "index.html");
  return (req, res) => {
    if (req.method !== "GET" && req.method !== "HEAD") return false;
    const url = new URL(req.url ?? "/", "http://studio.local");
    if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/studio/")) return false;
    let target = resolve(root, "." + decodeURIComponent(url.pathname));
    const rel = relative(root, target);
    if (rel.startsWith("..") || rel.includes(`..${sep}`)) target = index;
    if (!existsSync(target) || !statSync(target).isFile()) target = index;
    if (!existsSync(target)) return false;
    const stat = statSync(target);
    res.writeHead(200, { "content-type": TYPES[extname(target).toLowerCase()] ?? "application/octet-stream", "content-length": stat.size, "cache-control": target === index ? "no-store" : "public, max-age=3600" });
    if (req.method === "HEAD") { res.end(); return true; }
    createReadStream(target).pipe(res);
    return true;
  };
}