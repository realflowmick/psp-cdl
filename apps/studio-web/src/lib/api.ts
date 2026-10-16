// SPDX-License-Identifier: Apache-2.0
import type { PipelineConfig, PipelineRow, PipelineRunRecord, PipelineSession, PipelineSummary, Problem, PspContext, PspResolution, ValidationEnv } from "@psp-cdl/studio-core";
import type { AssistantProviderInfo, AssistantRecord, AssistantStartRequest, AssistantSummary, PreparedRun, PspxManifest, RunRecord, ScenarioCollection, StudioEvent } from "@psp-cdl/studio-core";

export class ApiError extends Error {
  constructor(public readonly code: string, public readonly status: number, message?: string) { super(message ?? code); this.name = "ApiError"; }
}
export interface StudioStatus {
  profile: string; version: string; engines: string[]; supportedEngines: string[]; inspectAllowed: boolean; workspace: string; activeRuns: number;
  vault: { mode: string; signing: SigningInfo }; notice: string;
}
export interface SigningInfo { configured: boolean; algorithm: string | null; keyId: string | null; publicKey: string | null }
export interface SecretSummary { name: string; configured: boolean; hint: string | null; updatedAt: string | null }
export interface WorkspaceFile { path: string; bytes: number; modifiedAt: string }
export interface Templates {
  campaignConfig: Record<string, unknown> | null;
  heldout: { plan: string; corpus: string };
  jointCaseIds: string[];
  studyConditions: string[];
  languages: string[];
}
export type AssistantProviderView = AssistantProviderInfo & { configured: boolean };
/** `progress` counts characters received while the model is still writing. */
export type AssistantView = AssistantRecord & { progress: number | null };
export type AssistantSummaryView = AssistantSummary & { progress: number | null };
export interface PspxUnpacked { manifest: PspxManifest; system: string; application: string; verified: { system: boolean; application: boolean }; warnings: string[] }
export interface PspxInterpreterView { id: string; label: string; files: string[]; available: boolean }
export type PipelineDetail = PipelineRow & { problems: Problem[]; sessions: { sessionId: string; startedAt: string; turn: number; version: number }[] };
export interface PipelineTurnInput {
  text?: string;
  file?: { name: string; mediaType?: string; text?: string; bytes?: number; path?: string };
  email?: { from?: string; subject?: string; body: string };
  webhook?: { method?: string; body: string };
}
export interface DriftReport {
  proxyId: string; backend: string | null; baseline: { digest: string; capturedAt: string; tools: number } | null; current: string | null; lastCheckAt: string | null;
  status: "ok" | "drifted" | "refusing" | "no-baseline" | "unconfigured" | "unreachable"; policy: "refuse" | "warn"; detail?: string;
  log: { seq: number; action: string; backend: string; previousDigest: string | null; digest: string | null; at: string; note: string | null }[];
}
export interface VectorStatus {
  storeId: string; engine: string; embedding: string; available: boolean; dims: number | null; exists: boolean; profile?: string | null; storedEmbedder?: string | null; error?: string;
  applications: { application: string; sectionType: string; sections: number; chunks: number; tokens: number }[]; sections: number; chunks: number;
}
export interface StartRequest { collectionId: string; scenarioId: string; label?: string; inspect?: boolean; admissionDigest?: string }

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, { method, headers: { "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  } catch (e) {
    throw new ApiError("NETWORK", 0, e instanceof Error ? e.message : "The studio server is unreachable.");
  }
  if (response.status === 204) return undefined as T;
  let parsed: unknown = null;
  try { parsed = await response.json(); } catch { /* non-JSON body */ }
  if (!response.ok) {
    const error = (parsed as { error?: { code?: string; message?: string } } | null)?.error;
    throw new ApiError(error?.code ?? `HTTP_${response.status}`, response.status, error?.message);
  }
  return parsed as T;
}

/** Sends text as the body (an uploaded .pspp) and returns the parsed JSON reply. */
async function callText<T>(method: string, path: string, text: string): Promise<T> {
  let response: Response;
  try { response = await fetch(path, { method, headers: { "content-type": "application/json" }, body: text }); }
  catch (e) { throw new ApiError("NETWORK", 0, e instanceof Error ? e.message : "The studio server is unreachable."); }
  let parsed: unknown = null;
  try { parsed = await response.json(); } catch { /* non-JSON body */ }
  if (!response.ok) {
    const error = (parsed as { error?: { code?: string; message?: string } } | null)?.error;
    throw new ApiError(error?.code ?? `HTTP_${response.status}`, response.status, error?.message);
  }
  return parsed as T;
}
/** Fetches a download: the body text and the file name from Content-Disposition. */
async function download(path: string): Promise<{ name: string; text: string }> {
  let response: Response;
  try { response = await fetch(path); } catch (e) { throw new ApiError("NETWORK", 0, e instanceof Error ? e.message : "The studio server is unreachable."); }
  const text = await response.text();
  if (!response.ok) {
    let error: { code?: string; message?: string } | undefined;
    try { error = (JSON.parse(text) as { error?: { code?: string; message?: string } }).error; } catch { /* not JSON */ }
    throw new ApiError(error?.code ?? `HTTP_${response.status}`, response.status, error?.message);
  }
  const disposition = response.headers.get("content-disposition") ?? "";
  const star = /filename*=UTF-8''([^;]+)/i.exec(disposition), plain = /filename="([^"]+)"/i.exec(disposition);
  return { name: star ? decodeURIComponent(star[1]!) : plain ? plain[1]! : "pipeline.pspp", text };
}
const pid = (id: string) => `/api/pipelines/${encodeURIComponent(id)}`;

/** Thin typed client over the studio server's JSON API. Paths are relative so the dev proxy and static hosting both work. */
export const api = {
  status: () => call<StudioStatus>("GET", "/api/status"),
  templates: () => call<Templates>("GET", "/api/templates"),
  collections: async () => (await call<{ collections: ScenarioCollection[] }>("GET", "/api/collections")).collections,
  putCollection: (collection: ScenarioCollection) => call<ScenarioCollection>("PUT", `/api/collections/${encodeURIComponent(collection.id)}`, collection),
  deleteCollection: (id: string) => call<void>("DELETE", `/api/collections/${encodeURIComponent(id)}`),
  files: () => call<{ root: string; files: WorkspaceFile[] }>("GET", "/api/workspace/files"),
  readFile: (path: string) => call<{ path: string; text: string; bytes: number; modifiedAt: string }>("GET", `/api/workspace/files/${path.split("/").map(encodeURIComponent).join("/")}`),
  writeFile: (path: string, text: string) => call<WorkspaceFile>("PUT", `/api/workspace/files/${path.split("/").map(encodeURIComponent).join("/")}`, { text }),
  secrets: () => call<{ mode: string; secrets: SecretSummary[]; signing: SigningInfo }>("GET", "/api/secrets"),
  setSecret: (name: string, value: string) => call<SecretSummary>("PUT", `/api/secrets/${encodeURIComponent(name)}`, { value }),
  deleteSecret: (name: string) => call<void>("DELETE", `/api/secrets/${encodeURIComponent(name)}`),
  generateSigning: (algorithm: "hmac-sha256" | "ed25519", keyId: string) => call<{ algorithm: string; keyId: string; publicKey: string | null }>("POST", "/api/secrets/signing/generate", { algorithm, keyId }),
  runs: async () => (await call<{ runs: RunRecord[] }>("GET", "/api/runs")).runs,
  run: (id: string) => call<RunRecord>("GET", `/api/runs/${encodeURIComponent(id)}`),
  events: (id: string, from = 1, limit = 10_000) => call<{ runId: string; events: StudioEvent[]; next: number }>("GET", `/api/runs/${encodeURIComponent(id)}/events?from=${from}&limit=${limit}`),
  cancel: (id: string) => call<RunRecord>("POST", `/api/runs/${encodeURIComponent(id)}/cancel`),
  prepare: (collectionId: string, scenarioId: string) => call<PreparedRun>("POST", "/api/runs/prepare", { collectionId, scenarioId }),
  start: (request: StartRequest) => call<RunRecord>("POST", "/api/runs", request),
  assistantProviders: async () => (await call<{ providers: AssistantProviderView[] }>("GET", "/api/assistant/providers")).providers,
  assistantRequests: async (path?: string) => (await call<{ requests: AssistantSummaryView[] }>("GET", `/api/assistant/requests${path ? `?path=${encodeURIComponent(path)}` : ""}`)).requests,
  assistantRequest: (id: string) => call<AssistantView>("GET", `/api/assistant/requests/${encodeURIComponent(id)}`),
  startAssistant: (request: AssistantStartRequest) => call<AssistantView>("POST", "/api/assistant/requests", request),
  acceptAssistant: (id: string, force = false) => call<AssistantView>("POST", `/api/assistant/requests/${encodeURIComponent(id)}/accept`, { force }),
  rejectAssistant: (id: string) => call<AssistantView>("POST", `/api/assistant/requests/${encodeURIComponent(id)}/reject`, {}),
  cancelAssistant: (id: string) => call<AssistantView>("POST", `/api/assistant/requests/${encodeURIComponent(id)}/cancel`, {}),
  pspxInterpreters: async () => (await call<{ interpreters: PspxInterpreterView[] }>("GET", "/api/pspx/interpreters")).interpreters,
  pspxPack: (input: { application: string; name: string; interpreter?: string; system?: string }) => call<{ text: string; manifest: PspxManifest }>("POST", "/api/pspx/pack", input),
  pspxUnpack: (text: string) => call<PspxUnpacked>("POST", "/api/pspx/unpack", { text }),
  pipelines: async () => (await call<{ pipelines: PipelineSummary[] }>("GET", "/api/pipelines")).pipelines,
  pipeline: (id: string) => call<PipelineDetail>("GET", pid(id)),
  createPipeline: (config: PipelineConfig) => call<PipelineRow>("POST", "/api/pipelines", config),
  savePipeline: (id: string, config: PipelineConfig, version: number) => call<PipelineRow>("PUT", pid(id), { config, version }),
  deletePipeline: (id: string) => call<void>("DELETE", pid(id)),
  duplicatePipeline: (id: string) => call<PipelineRow>("POST", `${pid(id)}/duplicate`, {}),
  exportPipeline: (id: string) => download(`${pid(id)}/export`),
  importPipeline: (text: string, onConflict?: "rename" | "overwrite", name?: string) => {
    const query = new URLSearchParams({ ...(onConflict ? { onConflict } : {}), ...(name ? { name } : {}) }).toString();
    return callText<{ row: PipelineRow; created: boolean }>("POST", `/api/pipelines/import${query ? `?${query}` : ""}`, text);
  },
  validatePipeline: (config: PipelineConfig, id?: string) => call<{ problems: Problem[]; env: ValidationEnv }>("POST", "/api/pipelines/validate", { config, ...(id ? { id } : {}) }),
  pipelineSchema: () => call<Record<string, unknown>>("GET", "/api/pipelines/schema"),
  pspSummary: (ref: string) => call<PspResolution>("GET", `/api/pipelines/psp?ref=${encodeURIComponent(ref)}`),
  startSession: (id: string) => call<PipelineSession>("POST", `${pid(id)}/session`, {}),
  endSession: (id: string, sessionId: string) => call<void>("DELETE", `${pid(id)}/session/${encodeURIComponent(sessionId)}`),
  sessionContext: (id: string, sessionId: string) => call<PspContext>("GET", `${pid(id)}/session/${encodeURIComponent(sessionId)}/context`),
  turn: (id: string, sessionId: string, input: PipelineTurnInput) => call<PipelineRunRecord>("POST", `${pid(id)}/session/${encodeURIComponent(sessionId)}/turn`, input),
  pipelineQueue: (id: string) => call<{ watch: string | null; files: WorkspaceFile[] }>("GET", `${pid(id)}/queue`),
  vectorStatus: (id: string, storeId: string) => call<VectorStatus>("GET", `/api/pipelines/vectors/${encodeURIComponent(storeId)}?pipeline=${encodeURIComponent(id)}`),
  drift: (id: string, proxyId: string, live = false) => call<DriftReport>("GET", `/api/pipelines/mcp/${encodeURIComponent(proxyId)}/drift?pipeline=${encodeURIComponent(id)}${live ? "" : "&live=0"}`),
  rebaseline: (id: string, proxyId: string, note: string) => call<DriftReport>("POST", `/api/pipelines/mcp/${encodeURIComponent(proxyId)}/rebaseline?pipeline=${encodeURIComponent(id)}`, { note })
};
export type Api = typeof api;