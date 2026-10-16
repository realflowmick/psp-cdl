// SPDX-License-Identifier: Apache-2.0
/**
 * MCPProxy backends. Connections use the reference `HttpMcpClient`, which pins the server identity and
 * the catalog fingerprint at initialize and refuses a call when discovery changes (DISCOVERY_CHANGED).
 * The first-run baseline and explicit re-baselines live in MCPProxy's own state file, never in a
 * configuration; a re-baseline is always a logged, explicit action.
 */
import { createHash } from "node:crypto";
import { canonicalJson } from "@psp-cdl/core";
import { HttpMcpClient } from "@psp-cdl/mcpproxy/mcp";
import { backendUrlProblem, type BackendCatalog, type CatalogTool, type Component } from "@psp-cdl/studio-core";
import { StudioError } from "../http/router.js";
import type { StudioDatabase } from "../db/database.js";

export type DriftStatus = "ok" | "drifted" | "refusing" | "no-baseline" | "unconfigured" | "unreachable";
export interface Baseline extends BackendCatalog { serverInfo: { name: string; version: string }; lastCheckAt: string | null; lastStatus: DriftStatus | null }
export interface BaselineLogEntry { seq: number; action: string; backend: string; previousDigest: string | null; digest: string | null; at: string; note: string | null }
export interface DriftReport { proxyId: string; backend: string | null; baseline: { digest: string; capturedAt: string; tools: number } | null; current: string | null; lastCheckAt: string | null; status: DriftStatus; policy: "refuse" | "warn"; detail?: string; log: BaselineLogEntry[] }

const words = (value: unknown): string[] => (Array.isArray(value) ? value : typeof value === "string" ? value.split(/[\s,]+/) : []).filter((t): t is string => typeof t === "string" && /^[a-z0-9][a-z0-9-]{0,63}$/.test(t));
/** Catalog entries as MCPProxy recorded them: the backend's own readOnlyHint and CDL tool-level capabilities (CDL §5.1). */
export function catalogTools(tools: readonly Record<string, unknown>[]): CatalogTool[] {
  return tools.map(t => {
    const annotations = (t.annotations && typeof t.annotations === "object" ? t.annotations : {}) as Record<string, unknown>;
    return {
      name: String(t.name),
      ...(typeof t.description === "string" ? { description: t.description.slice(0, 500) } : {}),
      readOnly: annotations.readOnlyHint === true,
      capabilities: [...new Set(words(t["x-cdl-capabilities"]))].sort()
    };
  });
}
/** Tool revision for gate registrations: a digest of the discovered tool object. */
export const toolRevision = (tool: Record<string, unknown>): string => "t-" + createHash("sha256").update(canonicalJson(tool)).digest("hex").slice(0, 24);

export interface BackendCredentialSource { (name: string): string | undefined }
export interface ConnectOptions { timeoutMs?: number; env?: BackendCredentialSource }
/** Opens a pinned connection. Fails with the reference client's codes (INVALID_INITIALIZATION, PEER_TIMEOUT, …). */
export async function connectBackend(proxy: Component, options: ConnectOptions = {}): Promise<HttpMcpClient> {
  const problem = backendUrlProblem(proxy.backend);
  if (problem) throw new StudioError("BACKEND_URL", 400, `${proxy.id}'s backend URL ${problem}.`);
  const info = proxy.serverInfo as { name?: unknown; version?: unknown } | undefined;
  if (!info || typeof info.name !== "string" || typeof info.version !== "string") throw new StudioError("SERVER_INFO_MISSING", 400, `${proxy.id} has no serverInfo; MCPProxy pins the backend's name and version at initialize.`);
  const url = new URL(String(proxy.backend));
  if (typeof proxy.auth !== "string") throw new StudioError("AUTH_REQUIRED", 400, `${proxy.id} has no auth; the reference MCP client always sends a bearer token.`);
  const name = proxy.auth.slice(4), token = (options.env ?? (n => process.env[n]))(name);
  if (!token) throw new StudioError("AUTH_UNSET", 400, `${name} is not set on the studio server.`);
  return HttpMcpClient.connect({
    endpoint: String(proxy.backend), allowLoopbackHttp: url.protocol === "http:", serverInfo: { name: info.name, version: info.version }, timeoutMs: options.timeoutMs ?? 10_000
  }, () => token);
}

interface StoredBaseline { pipeline_id: string; proxy_id: string; backend: string; digest: string; server_name: string; server_version: string; tools_json: string; captured_at: string; last_check_at: string | null; last_status: string | null }

export class BaselineStore {
  constructor(private readonly database: StudioDatabase) {}
  private get db() { return this.database.db; }
  get(pipelineId: string, proxyId: string): Baseline | null {
    const r = this.db.prepare("SELECT * FROM mcp_baseline WHERE pipeline_id = ? AND proxy_id = ?").get(pipelineId, proxyId) as StoredBaseline | undefined;
    if (!r) return null;
    return {
      proxyId, backend: r.backend, digest: r.digest, capturedAt: r.captured_at, serverInfo: { name: r.server_name, version: r.server_version },
      tools: JSON.parse(r.tools_json) as CatalogTool[], lastCheckAt: r.last_check_at, lastStatus: r.last_status as DriftStatus | null
    };
  }
  catalogs(pipelineId: string, proxyIds: readonly string[]): Record<string, BackendCatalog | null> {
    return Object.fromEntries(proxyIds.map(id => [id, this.get(pipelineId, id)]));
  }
  /** Records a catalog as the baseline. `captured` on first run; `rebaselined` only from the explicit route. */
  record(pipelineId: string, proxyId: string, backend: string, client: { catalogDigest: string; catalogSnapshot: { tools: Record<string, unknown>[] } }, serverInfo: { name: string; version: string }, action: "captured" | "rebaselined", note: string | null): Baseline {
    const previous = this.get(pipelineId, proxyId), now = new Date().toISOString();
    const tools = catalogTools(client.catalogSnapshot.tools);
    this.database.transaction(() => {
      this.db.prepare(`INSERT INTO mcp_baseline(pipeline_id, proxy_id, backend, digest, server_name, server_version, tools_json, captured_at, last_check_at, last_status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'ok')
        ON CONFLICT(pipeline_id, proxy_id) DO UPDATE SET backend = excluded.backend, digest = excluded.digest, server_name = excluded.server_name, server_version = excluded.server_version,
          tools_json = excluded.tools_json, captured_at = excluded.captured_at, last_check_at = excluded.last_check_at, last_status = 'ok'`)
        .run(pipelineId, proxyId, backend, client.catalogDigest, serverInfo.name, serverInfo.version, JSON.stringify(tools), now, now);
      this.db.prepare("INSERT INTO mcp_baseline_log(pipeline_id, proxy_id, backend, action, previous_digest, digest, at, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
        .run(pipelineId, proxyId, backend, action, previous?.digest ?? null, client.catalogDigest, now, note);
    });
    return this.get(pipelineId, proxyId)!;
  }
  checked(pipelineId: string, proxyId: string, status: DriftStatus): void {
    this.db.prepare("UPDATE mcp_baseline SET last_check_at = ?, last_status = ? WHERE pipeline_id = ? AND proxy_id = ?").run(new Date().toISOString(), status, pipelineId, proxyId);
  }
  log(pipelineId: string, proxyId: string): BaselineLogEntry[] {
    return (this.db.prepare("SELECT seq, action, backend, previous_digest, digest, at, note FROM mcp_baseline_log WHERE pipeline_id = ? AND proxy_id = ? ORDER BY seq DESC LIMIT 50").all(pipelineId, proxyId) as
      { seq: number; action: string; backend: string; previous_digest: string | null; digest: string | null; at: string; note: string | null }[])
      .map(r => ({ seq: Number(r.seq), action: r.action, backend: r.backend, previousDigest: r.previous_digest, digest: r.digest, at: r.at, note: r.note }));
  }
  /** A deleted pipeline's baselines go with it; the log keeps a `cleared` entry. */
  clear(pipelineId: string): void {
    this.database.transaction(() => {
      for (const b of this.db.prepare("SELECT proxy_id, backend, digest FROM mcp_baseline WHERE pipeline_id = ?").all(pipelineId) as { proxy_id: string; backend: string; digest: string }[]) {
        this.db.prepare("INSERT INTO mcp_baseline_log(pipeline_id, proxy_id, backend, action, previous_digest, digest, at, note) VALUES (?, ?, ?, 'cleared', ?, NULL, ?, 'pipeline deleted')").run(pipelineId, b.proxy_id, b.backend, b.digest, new Date().toISOString());
      }
      this.db.prepare("DELETE FROM mcp_baseline WHERE pipeline_id = ?").run(pipelineId);
    });
  }
}

/** Compares a fresh connection against the baseline. Never re-baselines. */
export async function checkDrift(store: BaselineStore, pipelineId: string, proxy: Component, options: ConnectOptions = {}): Promise<DriftReport> {
  const policy = proxy.drift === "warn" ? "warn" : "refuse";
  const baseline = store.get(pipelineId, proxy.id);
  const report = (status: DriftStatus, current: string | null, detail?: string): DriftReport => ({
    proxyId: proxy.id, backend: typeof proxy.backend === "string" ? proxy.backend : null, policy,
    baseline: baseline ? { digest: baseline.digest, capturedAt: baseline.capturedAt, tools: baseline.tools.length } : null,
    current, lastCheckAt: baseline ? new Date().toISOString() : null, status, ...(detail ? { detail } : {}), log: store.log(pipelineId, proxy.id)
  });
  if (!proxy.serverInfo || typeof proxy.auth !== "string" || backendUrlProblem(proxy.backend)) return report("unconfigured", null, "Set a valid backend URL, serverInfo and auth.");
  let client: HttpMcpClient;
  try { client = await connectBackend(proxy, options); }
  catch (e) { if (baseline) store.checked(pipelineId, proxy.id, "unreachable"); return report("unreachable", null, (e as { code?: string }).code ?? (e as Error).message); }
  try {
    if (!baseline) return report("no-baseline", client.catalogDigest, "The first run captures the baseline.");
    if (baseline.backend !== proxy.backend) return report("no-baseline", client.catalogDigest, `The baseline was captured for ${baseline.backend}.`);
    const status: DriftStatus = client.catalogDigest === baseline.digest ? "ok" : policy === "refuse" ? "refusing" : "drifted";
    store.checked(pipelineId, proxy.id, status);
    return report(status, client.catalogDigest);
  } finally { await client.close(); }
}

/** What MCPProxy's state already says, without connecting: the editor's view on load. */
export function storedDrift(store: BaselineStore, pipelineId: string, proxy: Component): DriftReport {
  const policy = proxy.drift === "warn" ? "warn" : "refuse";
  const baseline = store.get(pipelineId, proxy.id);
  const moved = !!baseline && baseline.backend !== proxy.backend;
  return {
    proxyId: proxy.id, backend: typeof proxy.backend === "string" ? proxy.backend : null, policy, current: null,
    baseline: baseline && !moved ? { digest: baseline.digest, capturedAt: baseline.capturedAt, tools: baseline.tools.length } : null,
    lastCheckAt: baseline?.lastCheckAt ?? null, status: !baseline || moved ? "no-baseline" : baseline.lastStatus ?? "ok",
    ...(moved ? { detail: `The baseline was captured for ${baseline!.backend}.` } : !baseline ? { detail: "The first run captures the baseline." } : {}),
    log: store.log(pipelineId, proxy.id)
  };
}

/** The explicit, logged re-baseline. */
export async function rebaseline(store: BaselineStore, pipelineId: string, proxy: Component, note: string | null, options: ConnectOptions = {}): Promise<DriftReport> {
  const client = await connectBackend(proxy, options).catch(e => { throw new StudioError((e as { code?: string }).code ?? "BACKEND_UNREACHABLE", 502, `${proxy.id} could not connect to its backend.`); });
  try { store.record(pipelineId, proxy.id, String(proxy.backend), client, proxy.serverInfo as { name: string; version: string }, "rebaselined", note); }
  finally { await client.close(); }
  return checkDrift(store, pipelineId, proxy, options);
}
