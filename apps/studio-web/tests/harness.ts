// SPDX-License-Identifier: Apache-2.0
// In-memory stand-ins for the studio server's HTTP API and socket. No network.
import { vi } from "vitest";
import { documentToObject, parseMarkup } from "@psp-cdl/core";
import { create as createDiffer } from "jsondiffpatch/with-text-diffs";
import {
  ASSISTANT_PROVIDERS, defaultCollection, formatPspp, formatPspx, parsePspp, parsePspx, pipelineJsonSchema, validatePipeline,
  type AssistantProvider, type AssistantRecord, type PipelineConfig, type PipelineRow, type PipelineRunRecord, type PipelineSession, type RunRecord, type ScenarioCollection, type StudioEvent, type ValidationEnv
} from "@psp-cdl/studio-core";

/** Stands in for the interpreter system prompt in packed PSPX files. */
export const PSPX_SYSTEM = "# PSP interpreter (test stand-in)\nInterpret the application below.";

type Listener = (...args: any[]) => void;
export const fakeSocket = {
  listeners: new Map<string, Set<Listener>>(),
  journals: new Map<string, StudioEvent[]>(),
  records: new Map<string, RunRecord>(),
  subscriptions: [] as { runId: string; fromSeq: number }[],
  on(event: string, listener: Listener) { (this.listeners.get(event) ?? this.listeners.set(event, new Set()).get(event)!).add(listener); },
  off(event: string, listener: Listener) { this.listeners.get(event)?.delete(listener); },
  emit(event: string, payload?: unknown, ack?: (reply: unknown) => void) {
    if (event !== "subscribe") return;
    const { runId, fromSeq } = payload as { runId: string; fromSeq: number };
    this.subscriptions.push({ runId, fromSeq });
    setTimeout(() => {
      const run = this.records.get(runId);
      ack?.(run ? { run } : { error: { code: "NOT_FOUND" } });
      this.fire("replay", { runId, events: (this.journals.get(runId) ?? []).filter(e => e.seq >= fromSeq), done: true });
    }, 0);
  },
  fire(event: string, ...args: unknown[]) { for (const listener of [...(this.listeners.get(event) ?? [])]) listener(...args); },
  reset() { this.listeners.clear(); this.journals.clear(); this.records.clear(); this.subscriptions = []; }
};

export const RUN: RunRecord = {
  runId: "20261012T100000Z-aaa111", scenarioId: "durable-echo", collectionId: "starter", engine: "live-loop", label: "Durable loop with a synthetic read tool",
  status: "completed", startedAt: "2026-10-12T10:00:00.000Z", finishedAt: "2026-10-12T10:00:04.000Z", lastSeq: 6, inspect: false, artifactDir: "C:/data/runs/x",
  summary: { turns: [{ turn: 1, code: "OK" }] }
};
export const ev = (seq: number, type: string, extra: Partial<StudioEvent> = {}): StudioEvent =>
  ({ runId: RUN.runId, seq, at: new Date(Date.parse(RUN.startedAt) + seq * 100).toISOString(), engine: "live-loop", source: "llmproxy", severity: "info", type, data: {}, ...extra });
export const JOURNAL: StudioEvent[] = [
  ev(1, "studio.run.status", { source: "studio", data: { status: "running" } }),
  ev(2, "studio.turn.start", { source: "studio", turn: 1, data: { turn: 1, requestId: "turn-1", message: "Please review my situation." } }),
  ev(3, "cdl.decision", { turn: 1, step: 1, data: { phase: "inference", decision: "allow", reasonCodes: [] } }),
  ev(4, "dispatch.released", { source: "mcpproxy", turn: 1, severity: "success", data: { toolName: "echo.read" } }),
  ev(5, "studio.turn.end", { source: "studio", turn: 1, severity: "success", data: { code: "OK", text: "Reviewed the record." } }),
  ev(6, "studio.run.status", { source: "studio", severity: "success", data: { status: "completed" } })
];

/** A small PSP application with a composite, parallel transitions and a natural-language condition. */
export const SUPPORT_APP = `\${psp type=node node-type=application name="support" session-id="synthetic-context" version="v1.0.0"}
  \${psp type=node node-type=prompt id="review" version="v1.0.0" transition-trust="verified"}
    \${psp type=system version="v1.0.0"}Assess the customer's needs.\${/psp}
    \${psp type=output-schema content-type=json}{"type":"object","properties":{"approved":{"type":"boolean"}}}\${/psp}
  \${/psp}
  \${psp type=node node-type=composite id="help" version="v1.0.0"}
    \${psp type=node node-type=prompt id="clarify" version="v1.0.0"}
      \${psp type=system version="v1.0.0"}Ask what remains unresolved.\${/psp}
    \${/psp}
  \${/psp}
  \${psp type=node node-type=prompt id="survey" version="v1.0.0"}
    \${psp type=system version="v1.0.0"}Ask for feedback.\${/psp}
  \${/psp}
  \${psp type=transitions content-type=json}
  [
    {"source_node":"review","target_node":"help","condition":"if the customer seems uncertain, offer clarification","priority":10},
    {"source_node":"review","target_node":"survey","condition":"approved == true"},
    {"source_node":"review","target_node":"survey","condition":"if the customer seems satisfied, route to survey"}
  ]
  \${/psp}
\${/psp}
`;

export interface MockState {
  collections: ScenarioCollection[];
  runs: RunRecord[];
  files: Record<string, string>;
  secrets: { name: string; configured: boolean; hint: string | null; updatedAt: string | null }[];
  prepared: Record<string, unknown>;
  calls: { url: string; method: string; body: any }[];
  failStatus: boolean;
  /** Which providers have a key in the vault. */
  keys: Record<AssistantProvider, boolean>;
  assistant: (AssistantRecord & { progress: number | null; polls: number })[];
  /** Text the scripted model proposes for the next request. */
  proposal: string;
  /** The next accept answers FILE_CHANGED, as when the file was edited after the request. */
  acceptConflict: boolean;
  pipelines: PipelineRow[];
  /** What POST /api/pipelines/validate returns as the environment (the PSP is dropped when psp is null). */
  pipelineEnv: ValidationEnv;
  /** Answers a turn; the default echoes a chat message. */
  turn: (input: Record<string, unknown>, turn: number) => Partial<PipelineRunRecord>;
  queue: { watch: string | null; files: { path: string; bytes: number; modifiedAt: string }[] };
  drift: Record<string, Record<string, unknown>>;
  /** The next PUT answers VERSION_CONFLICT, as when another tab saved first. */
  saveConflict: boolean;
}
const treeHash = (item: object): string | undefined => {
  const i = item as { kind?: string; value?: string; attributes?: Record<string, string> };
  if (i.kind === "text") return i.value?.trim() ? "text" : `ws:${i.value}`;
  return i.attributes ? `${i.attributes.type}:${i.attributes["node-type"] ?? ""}:${i.attributes.id ?? i.attributes.name ?? ""}` : undefined;
};
const differ = createDiffer({ objectHash: treeHash, textDiff: { minLength: 60 } });
const tree = (text: string | null) => text === null ? null : documentToObject(parseMarkup(text), false);
const summary = ({ before: _b, proposal: _p, delta: _d, polls: _q, ...rest }: MockState["assistant"][number]) => rest;
export function mockServer(): MockState {
  const state: MockState = {
    collections: [defaultCollection()],
    runs: [structuredClone(RUN)],
    files: { "application.psp": "${psp type=node node-type=application name=\"support\"}${/psp}", "notes/readme.md": "# Notes" },
    secrets: [
      { name: "openai.apiKey", configured: false, hint: null, updatedAt: null },
      { name: "anthropic.apiKey", configured: false, hint: null, updatedAt: null },
      { name: "signing", configured: false, hint: null, updatedAt: null }
    ],
    prepared: { engine: "live-loop", scenarioId: "durable-echo", preview: { loop: "durable" }, admissionDigest: "abc123", warnings: ["No signing key is stored in the vault."] },
    calls: [],
    failStatus: false,
    keys: { anthropic: true, openai: false },
    assistant: [],
    proposal: "",
    acceptConflict: false,
    pipelines: [],
    pipelineEnv: {},
    turn: (input, turn) => ({ turn, reply: `Echo: ${String(input.text ?? "")}`, delivery: "delivered", deliveredTo: "chat window" }),
    queue: { watch: null, files: [] },
    drift: {},
    saveConflict: false
  };
  const json = (value: unknown, status = 200) => new Response(status === 204 ? null : JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit = {}) => {
    const method = init.method ?? "GET", body = init.body ? JSON.parse(String(init.body)) : undefined;
    state.calls.push({ url, method, body });
    const path = new URL(url, "http://studio.local").pathname;
    let m: RegExpMatchArray | null;
    if (path === "/api/status") {
      if (state.failStatus) throw new TypeError("fetch failed");
      return json({ profile: "PSP-STUDIO-0.1", version: "0.1.0-dev.0", engines: ["live-loop"], supportedEngines: ["live-loop", "campaign"], inspectAllowed: true, workspace: "C:/ws", activeRuns: 0, vault: { mode: "key-file", signing: { configured: false, algorithm: null, keyId: null, publicKey: null } }, notice: "Development tooling. No security claim." });
    }
    if (path === "/api/templates") return json({ campaignConfig: { profile: "PSP-CAMPAIGN-0.1" }, heldout: { plan: "p.json", corpus: "c.json" }, jointCaseIds: ["natural-language"], studyConditions: ["combined"], languages: ["typescript", "python"] });
    if (path === "/api/collections") return json({ collections: state.collections });
    if ((m = path.match(/^\/api\/collections\/([^/]+)$/))) {
      const id = decodeURIComponent(m[1]!);
      if (method === "PUT") { const stored = { ...body, updatedAt: "2026-10-12T11:00:00.000Z" }; state.collections = [...state.collections.filter(c => c.id !== id), stored]; return json(stored); }
      if (method === "DELETE") { state.collections = state.collections.filter(c => c.id !== id); return json(null, 204); }
    }
    if (path === "/api/runs" && method === "GET") return json({ runs: state.runs });
    if (path === "/api/runs/prepare") return json(state.prepared);
    if (path === "/api/runs" && method === "POST") {
      if (state.prepared.admissionDigest && body.admissionDigest !== state.prepared.admissionDigest) return json({ error: { code: "NOT_ADMITTED" } }, 400);
      const record: RunRecord = { ...structuredClone(RUN), runId: "r9", status: "queued", lastSeq: 0, label: body.label ?? RUN.label };
      delete record.finishedAt; delete record.summary;
      state.runs = [record, ...state.runs];
      return json(record, 202);
    }
    if ((m = path.match(/^\/api\/runs\/([^/]+)$/))) { const run = state.runs.find(r => r.runId === decodeURIComponent(m![1]!)); return run ? json(run) : json({ error: { code: "NOT_FOUND" } }, 404); }
    if (path === "/api/workspace/files") return json({ root: "C:/ws", files: Object.entries(state.files).map(([p, t]) => ({ path: p, bytes: t.length, modifiedAt: "2026-10-12T09:00:00.000Z" })) });
    if ((m = path.match(/^\/api\/workspace\/files\/(.+)$/))) {
      const p = m[1]!.split("/").map(decodeURIComponent).join("/");
      if (method === "PUT") { state.files[p] = body.text; return json({ path: p, bytes: body.text.length, modifiedAt: "2026-10-12T11:00:00.000Z" }); }
      return p in state.files ? json({ path: p, text: state.files[p], bytes: state.files[p]!.length, modifiedAt: "2026-10-12T09:00:00.000Z" }) : json({ error: { code: "NOT_FOUND" } }, 404);
    }
    if (path === "/api/secrets") return json({ mode: "key-file", secrets: state.secrets, signing: { configured: false, algorithm: null, keyId: null, publicKey: null } });
    if ((m = path.match(/^\/api\/secrets\/([^/]+)$/)) && method === "PUT") {
      const name = decodeURIComponent(m[1]!);
      state.secrets = state.secrets.map(s => s.name === name ? { name, configured: true, hint: "…" + String(body.value).slice(-4), updatedAt: "2026-10-12T11:00:00.000Z" } : s);
      return json(state.secrets.find(s => s.name === name));
    }
    if (path === "/api/assistant/providers") return json({ providers: ASSISTANT_PROVIDERS.map(p => ({ ...p, configured: state.keys[p.id] })) });
    if (path === "/api/assistant/requests" && method === "GET") {
      const file = new URL(url, "http://studio.local").searchParams.get("path");
      return json({ requests: state.assistant.filter(r => !file || r.path === file).map(summary) });
    }
    if (path === "/api/assistant/requests" && method === "POST") {
      const id = `20261012T1200${String(state.assistant.length).padStart(2, "0")}Z-abc12${state.assistant.length}`;
      const before = body.mode === "modify" ? unwrap(state.files[body.path] ?? null, body.path) : null;
      const record: MockState["assistant"][number] = {
        id, createdAt: "2026-10-12T12:00:00.000Z", updatedAt: "2026-10-12T12:00:00.000Z", status: "running", mode: body.mode, path: body.path,
        format: body.path.endsWith(".pspx") ? "pspx" : "psp", baseId: body.baseId ?? null, provider: body.provider, model: body.model, prompt: body.prompt,
        attachments: (body.attachments ?? []).map((a: { name: string; mediaType: string; data: string }) => ({ name: a.name, mediaType: a.mediaType, kind: a.mediaType.startsWith("image/") ? "image" : "text", bytes: atob(a.data).length, sha256: "0".repeat(64) })),
        beforeSha256: before === null ? null : "b".repeat(64), before, proposal: null, summary: null, delta: null, usage: null, durationMs: null, attempts: 0, error: null, decidedAt: null,
        progress: 0, polls: 0
      };
      state.assistant.unshift(record);
      return json({ ...record, polls: undefined }, 202);
    }
    if ((m = path.match(/^\/api\/assistant\/requests\/([^/]+)(?:\/(accept|reject|cancel))?$/))) {
      const record = state.assistant.find(r => r.id === decodeURIComponent(m![1]!));
      if (!record) return json({ error: { code: "NOT_FOUND" } }, 404);
      const action = m[2];
      if (!action) {
        // The first poll still sees the model writing; the next one sees its proposal.
        if (record.status === "running" && record.polls++ > 0) {
          Object.assign(record, { status: "proposed", proposal: state.proposal, summary: "Added a thank-you node.", delta: differ.diff(tree(record.before), tree(state.proposal)) ?? null,
            usage: { inputTokens: 1200, outputTokens: 800 }, durationMs: 4200, attempts: 1, progress: null });
        } else if (record.status === "running") record.progress = 1200;
        return json({ ...record, polls: undefined });
      }
      if (action === "accept") {
        if (state.acceptConflict && !body?.force) { state.acceptConflict = false; return json({ error: { code: "FILE_CHANGED", message: `${record.path} changed after this request.` } }, 409); }
        state.files[record.path] = record.proposal!;
        Object.assign(record, { status: "accepted", decidedAt: "2026-10-12T12:05:00.000Z" });
      }
      if (action === "reject") Object.assign(record, { status: "rejected", decidedAt: "2026-10-12T12:05:00.000Z" });
      if (action === "cancel") Object.assign(record, { status: "cancelled" });
      return json({ ...record, polls: undefined });
    }
    if (path === "/api/pspx/pack") {
      const manifest = { profile: "PSPX-0.1" as const, interpreter: body.system !== undefined ? body.interpreter ?? "custom" : body.interpreter ?? "psp-core-3.2-draft-0.1", application: body.name.split("/").pop().replace(/\.pspx$/, ".psp"), exportedAt: "2026-10-12T12:00:00.000Z", systemSha256: "s", applicationSha256: "a" };
      return json({ text: formatPspx(manifest, body.system ?? PSPX_SYSTEM, body.application), manifest });
    }
    if (path === "/api/pspx/unpack") {
      try { return json({ ...parsePspx(body.text), verified: { system: true, application: true }, warnings: [] }); }
      catch (e) { return json({ error: { code: (e as { code?: string }).code ?? "NOT_PSPX", message: (e as Error).message } }, 400); }
    }
    if (path.startsWith("/api/pipelines")) return pipelineRoute(path, method, new URL(url, "http://studio.local").searchParams, init.body === undefined ? undefined : String(init.body), body);
    return json({ error: { code: "NOT_FOUND" } }, 404);
  }));
  let sessionTurns = 0;
  /** Pipeline routes, backed by the real studio-core parser, serializer and validator. */
  function pipelineRoute(path: string, method: string, query: URLSearchParams, raw: string | undefined, body: any): Response {
    const now = "2026-10-14T10:00:00.000Z";
    const envFor = (config: PipelineConfig): ValidationEnv => { const { psp: _psp, ...rest } = state.pipelineEnv; return config.psp ? state.pipelineEnv : rest; };
    const row = (id: string) => state.pipelines.find(p => p.id === id);
    const create = (config: PipelineConfig): PipelineRow => {
      const created: PipelineRow = { id: `0199e0a1-0000-7000-8000-${String(state.pipelines.length + 1).padStart(12, "0")}`, name: config.name, description: config.description ?? null, pspRef: config.psp?.document ?? null, config: structuredClone(config), version: 1, createdAt: now, updatedAt: now };
      state.pipelines.push(created);
      return created;
    };
    let m: RegExpMatchArray | null;
    if (path === "/api/pipelines" && method === "GET") return json({ pipelines: state.pipelines.map(({ config: _c, createdAt: _a, ...r }) => r) });
    if (path === "/api/pipelines" && method === "POST") return json(create(body), 201);
    if (path === "/api/pipelines/schema") return json(pipelineJsonSchema());
    if (path === "/api/pipelines/validate") return json({ problems: validatePipeline(body.config, envFor(body.config)), env: envFor(body.config) });
    if (path === "/api/pipelines/psp") return json(state.pipelineEnv.psp ?? { status: "unresolved", pointer: query.get("ref"), reason: "Not set in the mock." });
    if (path === "/api/pipelines/import") {
      let config: PipelineConfig;
      try { config = parsePspp(raw ?? ""); } catch (e) { return json({ error: { code: (e as { code?: string }).code ?? "INVALID_PIPELINE", message: (e as Error).message } }, 400); }
      const existing = state.pipelines.find(p => p.name.toLowerCase() === config.name.toLowerCase());
      const onConflict = query.get("onConflict");
      if (existing && !onConflict) return json({ error: { code: "NAME_CONFLICT", message: `A pipeline named ${existing.name} exists.` } }, 409);
      if (existing && onConflict === "overwrite") { Object.assign(existing, { config, version: existing.version + 1 }); return json({ row: existing, created: false }); }
      return json({ row: create(existing ? { ...config, name: query.get("name") ?? `${config.name} (2)` } : config), created: true }, 201);
    }
    if ((m = path.match(/^\/api\/pipelines\/mcp\/([^/]+)\/drift$/))) return json(state.drift[m[1]!] ?? { proxyId: m[1], backend: null, baseline: null, current: null, lastCheckAt: null, status: "no-baseline", policy: "refuse", log: [] });
    if ((m = path.match(/^\/api\/pipelines\/vectors\/([^/]+)$/))) return json({ storeId: m[1], engine: "sqlite-vec", embedding: "all-MiniLM-L6-v2", available: false, dims: 384, exists: true, applications: [{ application: "intake.psp", sectionType: "system", sections: 1, chunks: 41, tokens: 900 }], sections: 1, chunks: 41 });
    if (!(m = path.match(/^\/api\/pipelines\/([^/]+)(\/.*)?$/))) return json({ error: { code: "NOT_FOUND" } }, 404);
    const target = row(m[1]!), rest = m[2] ?? "";
    if (!target) return json({ error: { code: "NOT_FOUND" } }, 404);
    if (!rest && method === "GET") return json({ ...target, problems: validatePipeline(target.config, envFor(target.config)), sessions: [] });
    if (!rest && method === "PUT") {
      if (state.saveConflict || body.version !== target.version) { state.saveConflict = false; return json({ error: { code: "VERSION_CONFLICT", message: `This pipeline was saved elsewhere (version ${target.version + 1}).` } }, 409); }
      Object.assign(target, { config: structuredClone(body.config), name: body.config.name, description: body.config.description ?? null, pspRef: body.config.psp?.document ?? null, version: target.version + 1, updatedAt: "2026-10-14T11:00:00.000Z" });
      return json(target);
    }
    if (!rest && method === "DELETE") { state.pipelines = state.pipelines.filter(p => p !== target); return json(null, 204); }
    if (rest === "/duplicate") return json(create({ ...target.config, name: `${target.name} (copy)` }), 201);
    if (rest === "/export") return new Response(formatPspp(target.config), { status: 200, headers: { "content-type": "application/json", "content-disposition": `attachment; filename="${target.name}.pspp"` } });
    if (rest === "/queue") return json(state.queue);
    const context = (turn: number) => ({ sessionId: "sess-1", turn, loops: 0, node: "intake_review", nodeVersion: "v1", decisions: turn * 3, status: "running", stateBytes: 2 });
    if (rest === "/session" && method === "POST") {
      sessionTurns = 0;
      const session: PipelineSession = { sessionId: "sess-1", pipelineId: target.id, version: target.version, startedAt: now, context: context(0), warnings: [], registrations: { node: "intake_review", allowed: ["crm.lookup"], withheldByNode: [], withheldByCovenant: [], withheldByMode: [], unknownBackends: [] } };
      return json(session, 201);
    }
    if (/^\/session\/[^/]+$/.test(rest) && method === "DELETE") return json(null, 204);
    if (/^\/session\/[^/]+\/turn$/.test(rest)) {
      sessionTurns++;
      const record: PipelineRunRecord = {
        sessionId: "sess-1", turn: sessionTurns, at: now, input: { trigger: "chat", summary: "chat message" }, trace: [{ at: now, where: "initiator", detail: "chat → chat message" }],
        registrations: { allowed: ["crm.lookup"], withheldByNode: [], withheldByCovenant: [], withheldByMode: [] }, toolLoop: { turns: 0, calls: [] },
        responseFilters: [{ kind: "covenant-gate", order: 0, verdict: "pass" }], reply: "", delivery: "delivered", taps: [], context: context(sessionTurns), ...state.turn(body, sessionTurns)
      };
      return json(record);
    }
    return json({ error: { code: "NOT_FOUND" } }, 404);
  }
  /** The application part of a stored file, as the server reads it. */
  function unwrap(text: string | null, file: string): string | null {
    return text !== null && file.endsWith(".pspx") ? parsePspx(text).application : text;
  }
  return state;
}
