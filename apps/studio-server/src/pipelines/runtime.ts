// SPDX-License-Identifier: Apache-2.0
/**
 * Sessions and turns on saved pipelines. The configuration tells the reference LLMProxy loop and the
 * MCPProxy client what to run; this module only composes them:
 *
 * - psp-verify: the loop verifies the host-signed prompt itself (verifyEnvelope) on every step.
 * - agents-registration: node affinity in McpDispatchGate; without the slot every tool is named.
 * - covenant-pruning: registrations whose capabilities CDL evaluatePolicy rejects are not registered.
 * - covenant-gate: the loop's release phase, against the sink's capabilities (OUTPUT_DENIED).
 * - exfil-guard: authorizeFinal calls ExfiltrationStore.assess (PSP-EXFIL-0.1).
 * - data-use-check: no reference implementation; reported as unsupported.
 *
 * Node choice, transitions and the meaning of the PSP stay with the model. Nothing here interprets PSP.
 */
import { createHash, randomBytes } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, unlinkSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { dirname, isAbsolute, join, normalize, posix, sep } from "node:path";
import { canonicalJson } from "@psp-cdl/core";
import { ExfiltrationStore, HashingEmbedder, HASH_EMBEDDER_ID, type Assessment } from "@psp-cdl/api-server/exfiltration";
import { OwnerCoordinator } from "@psp-cdl/api-server/persistence";
import { McpDispatchGate } from "@psp-cdl/mcpproxy";
import { DurableLlmLoop, LockdownError, type BufferedLlmLoop, type LoopHost, type ProviderRegistration } from "@psp-cdl/llmproxy";
import type { ObserveEvent, ToolRegistration } from "@psp-cdl/mcpproxy";
import type { HttpMcpClient } from "@psp-cdl/mcpproxy/mcp";
import { getLoadablePath } from "sqlite-vec";
import {
  attachment, conflictingTerm, filterInfo, filterKind, filterOptionsOf, filtersOf, hasFilter, inferProvider, PSPX_INTERPRETERS, primaryProxy, replyMode, serverName,
  sinkCapabilities, TAP_CAPABILITIES, terminals, toolDeclarations, validatePipeline,
  type Component, type FilterVerdict, type LiveLoopScenario, type PipelineConfig, type PipelineRunRecord, type PipelineSession, type PspContext,
  type RegistrationPreview, type ScriptedReply, type TraceEntry, type ValidationEnv
} from "@psp-cdl/studio-core";
import { StudioError } from "../http/router.js";
import { buildHarness, OPERATOR_TOKEN, type Harness, type SigningMaterial } from "../engines/live-loop/harness.js";
import type { EngineServices } from "../engines/types.js";
import { BaselineStore, catalogTools, connectBackend, toolRevision } from "./backends.js";
import { loadPsp, pspResolution, type LoadedPsp } from "./psp.js";
import type { PipelineStore } from "./store.js";

/** Model-visible text when a pipeline has no PSP. Kept minimal on purpose. */
export const NO_PSP_TEXT = "No PSP document is attached to this conversation. Answer the user's message.";
const MAX_SESSIONS = 8, IDLE_MS = 30 * 60_000, TURN_SECONDS = 120, MAX_TEXT = 65_536;
const SEVERITY: Record<string, number> = { clear: 0, suspicious: 1, leak: 2 };

export interface TurnInput {
  text?: string;
  file?: { name: string; mediaType?: string; text?: string; bytes?: number; path?: string };
  email?: { from?: string; subject?: string; body: string };
  webhook?: { method?: string; body: string };
}
export type ProviderFactory = (model: Component, context: { turn: () => number; message: () => string }) => ProviderRegistration | undefined;
export interface RuntimeOptions {
  store: PipelineStore;
  baselines: BaselineStore;
  services: EngineServices;
  dataDir: string;
  env?: NodeJS.ProcessEnv;
  /** Test hook: supplies the model provider instead of the configured one. */
  provider?: ProviderFactory;
}

interface CallRecord { proxyId: string; tool: string; drift: "ok" | "refused" | "warned"; outcome: string }
interface LiveSession {
  id: string; pipelineId: string; version: number; config: PipelineConfig; harness: Harness; dir: string; startedAt: string; lastUsed: number;
  clients: HttpMcpClient[]; exfil: ExfiltrationStore | null; application: string; psp: LoadedPsp | null; providerKind: string;
  registrations: RegistrationPreview; warnings: string[]; turn: number; loops: number; decisions: number; busy: boolean;
  /** Per-turn buffers filled by observers and callbacks. */
  trace: TraceEntry[]; calls: CallRecord[]; finalVerdicts: PipelineRunRecord["responseFilters"] | null; onTrace?: ((entry: TraceEntry) => void) | undefined;
  /** Read by the mock provider: the current turn number and message. */
  box: { turn: number; message: string };
}

/** Resolves a configuration path (vector store, logger sink) inside the pipeline's data folder. */
export function pipelinePath(dataDir: string, pipelineId: string, rel: string): string {
  const root = join(dataDir, "pipelines", pipelineId);
  const clean = normalize(rel.replace(/^\.\//, ""));
  if (!rel || isAbsolute(rel) || /^[A-Za-z]:/.test(rel) || clean.split(sep).includes("..")) throw new StudioError("INVALID_PATH", 400, `${rel} must be a path inside the pipeline's data folder.`);
  return join(root, clean);
}
const textLike = (type: string | undefined, name: string) => /^text\/|json|xml|yaml|csv|markdown/.test(type ?? "") || /\.(txt|md|json|csv|ya?ml|xml|html?)$/i.test(name);
const digest = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");
const clip = (text: string, max = MAX_TEXT) => text.length > max ? text.slice(0, max) : text;

/** Glob over workspace paths: `*` and `?` stay in one segment, `**` crosses segments. */
export function globRegExp(glob: string): RegExp {
  let out = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]!;
    if (c === "*" && glob[i + 1] === "*") { out += ".*"; i++; if (glob[i + 1] === "/") i++; }
    else if (c === "*") out += "[^/]*";
    else if (c === "?") out += "[^/]";
    else out += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${out}$`);
}

export class PipelineRuntime {
  private readonly sessions = new Map<string, LiveSession>();
  private readonly sweeper: ReturnType<typeof setInterval>;
  constructor(private readonly options: RuntimeOptions) {
    this.sweeper = setInterval(() => { for (const s of this.sessions.values()) if (!s.busy && Date.now() - s.lastUsed > IDLE_MS) void this.close(s.id); }, 60_000);
    this.sweeper.unref();
  }
  private get env(): NodeJS.ProcessEnv { return this.options.env ?? process.env; }
  hasLive(pipelineId: string): boolean { return [...this.sessions.values()].some(s => s.pipelineId === pipelineId); }
  list(pipelineId: string): { sessionId: string; startedAt: string; turn: number; version: number }[] {
    return [...this.sessions.values()].filter(s => s.pipelineId === pipelineId).map(s => ({ sessionId: s.id, startedAt: s.startedAt, turn: s.turn, version: s.version }));
  }
  /** Embedding models this server can load. The ONNX model needs a host model directory, which the studio does not configure. */
  embedders(): string[] { return [HASH_EMBEDDER_ID]; }

  /** The facts the shared validator needs: the PSP behind the pointer, catalogs, keys, environment names. */
  validationEnv(config: PipelineConfig, selfId?: string): ValidationEnv {
    const { workspace, vault } = this.options.services;
    const signing = vault.describeSigning();
    const loops = config.components.filter(c => c.kind === "mcpproxy").map(c => c.id);
    return {
      ...(config.psp ? { psp: pspResolution(config.psp.document, workspace, vault, this.env) } : {}),
      otherNames: this.options.store.names(selfId),
      catalogs: selfId ? this.options.baselines.catalogs(selfId, loops) : Object.fromEntries(loops.map(id => [id, null])),
      signing: { configured: signing.configured, algorithm: signing.algorithm },
      embedders: this.embedders(),
      envSet: config.components.flatMap(c => typeof c.auth === "string" && c.auth.startsWith("env:") && this.env[c.auth.slice(4)] ? [c.auth.slice(4)] : [])
    };
  }

  private signing(algorithm: "ed25519" | "hmac-sha256"): SigningMaterial {
    const key = this.options.services.vault.signingKey();
    if (key && key.algorithm === algorithm) return { source: "vault", ...key };
    return { source: "ephemeral", algorithm, keyId: "pipeline-session", material: new Uint8Array(randomBytes(32)) };
  }

  /** Starts a session on the saved row: bootstrap the PSP, connect backends, register tools, build the loop. */
  async start(pipelineId: string): Promise<PipelineSession> {
    if (this.sessions.size >= MAX_SESSIONS) throw new StudioError("TOO_MANY_SESSIONS", 429, `At most ${MAX_SESSIONS} pipeline sessions may be live.`);
    const row = this.options.store.get(pipelineId), config = row.config;
    const env = this.validationEnv(config, pipelineId);
    const errors = validatePipeline(config, env).filter(p => p.severity === "error");
    if (errors.length) throw new StudioError("PIPELINE_INVALID", 422, errors.slice(0, 6).map(p => p.message).join(" "));
    const warnings: string[] = [];
    const { model, initiator } = terminals(config);
    const proxy = primaryProxy(config)!;

    // Bootstrap document.
    let psp: LoadedPsp | null = null;
    if (config.psp) {
      const loaded = loadPsp(config.psp.document, this.options.services.workspace, this.options.services.vault, this.env);
      if (loaded.status !== "resolved") throw new StudioError("PSP_UNRESOLVED", 422, loaded.reason);
      psp = loaded.loaded;
    }
    const summary = psp?.summary ?? null;
    const context = { covenants: summary?.covenants ?? [], classes: summary?.classes ?? [] };
    const pruning = hasFilter(proxy, "request", "covenant-pruning");

    // Provider. Nothing here calls a model unless a turn asks.
    const kind = inferProvider(String(model!.model ?? ""), model!.provider) ?? "mock";
    const box: LiveSession["box"] = { turn: 0, message: "", failure: null };
    let provider = this.options.provider?.(model!, { turn: () => box.turn, message: () => box.message });
    if (!provider && kind === "mock") provider = mockProvider(model!, () => box.turn, () => box.message);
    if (!provider && kind === "anthropic") {
      const apiKey = this.options.services.vault.get("anthropic.apiKey");
      if (!apiKey) throw new StudioError("CREDENTIAL_MISSING", 422, "Store anthropic.apiKey on the Secrets page before running an Anthropic model.");
      try {
        provider = createAnthropicProvider({
          apiKey, model: String(model!.model), sources: [{ id: "provider", capabilities: [] }], complete: true, now: () => Math.floor(Date.now() / 1000),
          // Per session: the provider lives as long as the session does.
          limits: { maxRequestBytes: 1_048_576, maxResponseBytes: 1_048_576, maxOutputTokens: 4096, maxCalls: 256, budgetTokens: 2_000_000, timeoutMs: TURN_SECONDS * 1000 },
          onFailure: failure => { box.failure = describeAnthropicFailure(failure); },
          ...(this.options.services.fetch ? { fetch: this.options.services.fetch } : {})
        });
      } catch (e) { throw new StudioError("INVALID_MODEL", 422, (e as { detail?: string }).detail ?? `${String(model!.model)} cannot be used as an Anthropic model id.`); }
    }

    // Backends: pinned connections, drift against the baseline, host approvals, covenant pruning.
    const clients: HttpMcpClient[] = [], registrations: ToolRegistration[] = [];
    const preview: RegistrationPreview = { node: summary?.entryNode?.id ?? null, allowed: [], withheldByNode: [], withheldByCovenant: [], withheldByMode: [], unknownBackends: [] };
    const now = () => Math.floor(Date.now() / 1000);
    const pending: { recordCall: (call: CallRecord) => void } = { recordCall: () => {} };
    const uris: string[] = [];
    for (const loop of config.components.filter(c => c.kind === "mcpproxy" && attachment(config, c) === "loop")) {
      let client: HttpMcpClient;
      try { client = await connectBackend(loop, { env: n => this.env[n] }); }
      catch (e) { warnings.push(`${loop.id}: ${(e as { code?: string }).code ?? (e as Error).message}; its tools are not registered.`); preview.unknownBackends.push(loop.id); continue; }
      clients.push(client);
      const baseline = this.options.baselines.get(pipelineId, loop.id);
      let refusing = false, drifted = false;
      if (!baseline || baseline.backend !== loop.backend) {
        this.options.baselines.record(pipelineId, loop.id, String(loop.backend), client, loop.serverInfo as { name: string; version: string }, "captured", "first run");
        warnings.push(`${loop.id}: captured the drift baseline on first run.`);
      } else if (baseline.digest !== client.catalogDigest) {
        drifted = true; refusing = loop.drift !== "warn";
        this.options.baselines.checked(pipelineId, loop.id, refusing ? "refusing" : "drifted");
        warnings.push(`${loop.id}: the backend's catalog differs from the baseline; ${refusing ? "tool calls are refused" : "continuing because drift is set to warn"}.`);
      } else this.options.baselines.checked(pipelineId, loop.id, "ok");
      const server = serverName(loop);
      const declared = toolDeclarations(loop, { proxyId: loop.id, backend: String(loop.backend), digest: client.catalogDigest, capturedAt: "", tools: catalogTools(client.catalogSnapshot.tools) });
      const approvals = [];
      for (const tool of client.catalogSnapshot.tools) {
        const d = declared.find(x => x.name === tool.name)!;
        const term = pruning ? conflictingTerm(context, d.capabilities) : null;
        if (term) { preview.withheldByCovenant.push({ tool: d.label, covenant: term }); continue; }
        uris.push(d.uri);
        approvals.push({ name: d.name, revision: toolRevision(tool), readOnly: d.readOnly, complete: true, sources: [{ id: "server", capabilities: d.capabilities }], inputSchema: tool.inputSchema as Record<string, unknown>, outputSchema: tool.outputSchema as Record<string, unknown> });
      }
      for (const r of client.registrations(server, approvals, now)) {
        const refused = admission(r);
        if (refused) { (preview.unsupported ??= []).push({ tool: `${server}.${r.name}`, code: refused }); warnings.push(`${server}.${r.name}: the reference gate refuses to register it (${refused}).`); continue; }
        registrations.push({ ...r, invoke: async (args, options) => {
          const label = `${server}.${r.name}`;
          if (refusing) { pending.recordCall({ proxyId: loop.id, tool: label, drift: "refused", outcome: "DRIFT_REFUSED" }); throw new Error("DRIFT_REFUSED"); }
          try {
            const out = await r.invoke(args, options);
            pending.recordCall({ proxyId: loop.id, tool: label, drift: drifted ? "warned" : "ok", outcome: "OK" });
            return out;
          } catch (e) {
            const code = (e as { code?: string }).code ?? "TOOL_FAILED";
            pending.recordCall({ proxyId: loop.id, tool: label, drift: code === "DISCOVERY_CHANGED" ? "refused" : drifted ? "warned" : "ok", outcome: code });
            if (code === "DISCOVERY_CHANGED") this.options.baselines.checked(pipelineId, loop.id, loop.drift === "warn" ? "drifted" : "refusing");
            throw e;
          }
        } });
      }
    }

    // Node affinity: the entry node's agents with agents-registration, else every registered tool.
    const entry = summary?.entryNode ?? null;
    const byNode = !!entry && hasFilter(proxy, "request", "agents-registration");
    const agents = byNode ? entry!.agents : uris;

    // Prompt text: a .pspx keeps its own system prompt; a .psp gets the shipped interpreter, as in the live loop.
    const application = psp?.application ?? "";
    const interpreter: LiveLoopScenario["interpreter"] = psp && psp.summary.format === "psp" ? PSPX_INTERPRETERS[0]!.id as LiveLoopScenario["interpreter"] : "none";
    const source = !psp ? NO_PSP_TEXT : psp.system !== null ? `${psp.system}\n\n${application}` : application;
    const sinkCaps = sinkCapabilities(initiator);
    const gate = hasFilter(proxy, "response", "covenant-gate");
    const scenario: LiveLoopScenario = {
      kind: "live-loop", id: "pipeline", label: config.name, application: { source }, interpreter,
      loop: proxy.lockdown === "post-completion" ? "durable" : "buffered",
      provider: kind === "openai" ? { kind: "openai", model: String(model!.model) } : { kind: "mock", script: [] },
      tools: [], node: { nodeId: entry?.id ?? "pipeline", nodeVersion: entry?.version ?? "v1", agents },
      initialState: {}, turns: [],
      policy: {
        default: { classes: context.classes, covenants: context.covenants, capabilities: [] },
        // Without Covenant Gate the release phase carries no covenants.
        ...(gate ? {} : { overrides: [{ phase: "release" as const, resource: { classes: [], covenants: [], capabilities: [] } }] })
      },
      releaseCapabilities: sinkCaps, providerCapabilities: [],
      plan: { statePolicy: "accumulate" }, limits: { maxSteps: 8, maxRounds: 4, deadlineSeconds: TURN_SECONDS }, clock: "wall"
    } as LiveLoopScenario;

    // Exfil Guard's store; the verified application text is registered for this session.
    let exfil: ExfiltrationStore | null = null;
    const guard = filtersOf(proxy, "response").find(s => filterKind(s) === "exfil-guard");
    if (guard) {
      const options = filterOptionsOf(guard);
      const store = typeof proxy.vectorStore === "string" ? config.components.find(c => c.id === proxy.vectorStore && c.kind === "vector-store") : undefined;
      const embedding = typeof store?.embedding === "string" ? store.embedding : HASH_EMBEDDER_ID;
      const embedder = store && embedding === HASH_EMBEDDER_ID ? new HashingEmbedder() : null;
      if (store && !embedder) warnings.push(`${embedding} is not available on this server; Exfil Guard runs the lexical tier only.`);
      const path = store ? pipelinePath(this.options.dataDir, pipelineId, String(store.path)) : pipelinePath(this.options.dataDir, pipelineId, "exfil-lexical.sqlite");
      mkdirSync(dirname(path), { recursive: true });
      exfil = new ExfiltrationStore(path, {
        key: this.exfiltrationKey(), embedder,
        vector: embedder && store?.engine === "sqlite-vec" ? { sqliteVec: getLoadablePath() } : "portable",
        ...(typeof options.threshold === "number" ? { thresholds: { strongDistance: options.threshold } } : {})
      });
    }

    const dir = join(this.options.dataDir, "pipelines", pipelineId, "sessions", `${Date.now()}-${randomBytes(3).toString("hex")}`);
    mkdirSync(dir, { recursive: true });
    const live: Partial<LiveSession> = { trace: [], calls: [], finalVerdicts: null, decisions: 0, loops: 0 };
    pending.recordCall = call => { live.calls!.push(call); live.loops = (live.loops ?? 0) + 1; this.trace(live as LiveSession, "mcpproxy", `${call.tool} → ${call.outcome}${call.drift !== "ok" ? ` (drift ${call.drift})` : ""}`); };
    const observer = (e: ObserveEvent) => {
      if (e.type === "cdl.decision") live.decisions = (live.decisions ?? 0) + 1;
      const where: TraceEntry["where"] = e.type.startsWith("inference.") ? "model" : e.type.startsWith("dispatch.") ? "mcpproxy" : (e.data as { phase?: unknown }).phase === "release" ? "llmproxy.response" : "llmproxy.request";
      const data = e.data as Record<string, unknown>;
      const detail = [e.type, data.phase, data.decision, data.toolName, data.code].filter(v => typeof v === "string").join(" · ");
      this.trace(live as LiveSession, where, detail);
    };
    const authorizeFinal: LoopHost["authorizeFinal"] = async (_p, _binding, data) => {
      const text = String((data.candidate as { text?: unknown } | undefined)?.text ?? "");
      const verdicts = await this.finalFilters(live as LiveSession, proxy, exfil, text);
      live.finalVerdicts = verdicts;
      return !verdicts.some(v => v.verdict === "block");
    };
    let harness: Harness;
    try {
      harness = await buildHarness(scenario, this.options.services, {
        dir, runId: `pipeline-${pipelineId.slice(-12)}`, observe: { observer, level: "digest" }, emit: () => {}, cancelled: () => false, live: kind === "openai",
        registrations, ...(provider ? { provider } : {}), authorizeFinal, signing: this.signing(config.psp?.signOnRetrieval ?? (this.options.services.vault.signingKey()?.algorithm ?? "hmac-sha256"))
      });
    } catch (e) {
      exfil?.close(); for (const c of clients) await c.close().catch(() => {});
      rmSync(dir, { recursive: true, force: true });
      throw new StudioError((e as { code?: string }).code ?? "SESSION_FAILED", 422, (e as Error).message);
    }
    if (exfil && psp && application.trim()) {
      await exfil.protect({ application: psp.resolved.path, sectionType: "system", text: application, sessionId: harness.sessionId, label: `${psp.resolved.path}/system` });
    }
    // What the gate actually lists for the node: the reference decides, not this module.
    try {
      const listed = await harness.gate.listTools(OPERATOR_TOKEN, harness.sessionId, { deadline: now() + 30, cancelled: () => false }) as { name: string }[];
      preview.allowed = listed.map(t => t.name);
    } catch (e) { warnings.push(`Listing tools failed: ${(e as { code?: string }).code ?? (e as Error).message}.`); }
    for (const r of registrations) {
      const label = `${r.server}.${r.name}`;
      if (preview.allowed.includes(label)) continue;
      if (!agents.includes(`mcp://${r.server}/${r.name}`)) preview.withheldByNode.push(label);
      else if (!r.readOnly) preview.withheldByMode.push(label);
    }

    const session: LiveSession = Object.assign(live, {
      id: harness.sessionId, pipelineId, version: row.version, config, harness, dir, startedAt: new Date().toISOString(), lastUsed: Date.now(),
      clients, exfil, application: psp?.resolved.path ?? config.name, psp, providerKind: kind, registrations: preview, warnings, turn: 0, busy: false, box
    }) as LiveSession;
    this.sessions.set(session.id, session);
    return { sessionId: session.id, pipelineId, version: row.version, startedAt: session.startedAt, context: await this.context(pipelineId, session.id), warnings, registrations: preview };
  }

  private exfiltrationKey(): Uint8Array {
    const file = join(this.options.dataDir, "exfiltration.key");
    if (!existsSync(file)) { mkdirSync(this.options.dataDir, { recursive: true }); appendFileSync(file, randomBytes(32).toString("hex"), { mode: 0o600 }); }
    return new Uint8Array(Buffer.from(readFileSync(file, "utf8").trim(), "hex"));
  }

  private trace(session: LiveSession, where: TraceEntry["where"], detail: string): void {
    const entry = { at: new Date().toISOString(), where, detail };
    session.trace.push(entry);
    try { session.onTrace?.(entry); } catch { /* a closed stream never affects the turn */ }
  }

  /** Response filters that run inside authorizeFinal, in slot order. Never throws: the loop maps a throw to HOST_ERROR. */
  private async finalFilters(session: LiveSession, proxy: Component, exfil: ExfiltrationStore | null, text: string): Promise<PipelineRunRecord["responseFilters"]> {
    const out: PipelineRunRecord["responseFilters"] = [];
    for (const [order, spec] of filtersOf(proxy, "response").entries()) {
      const kind = filterKind(spec), options = filterOptionsOf(spec);
      if (kind === "covenant-gate") continue;
      if (kind === "exfil-guard") {
        if (!exfil) { out.push({ kind, order, verdict: "skipped", evidence: "No store." }); continue; }
        try {
          const a: Assessment = await exfil.assess({ application: session.application, text });
          const blockAt = options.block === "suspicious" ? 1 : 2;
          const verdict: FilterVerdict = SEVERITY[a.disposition]! >= blockAt || !a.complete ? "block" : a.disposition === "clear" ? "pass" : "warn";
          out.push({ kind, order, verdict, score: a.signal, evidence: `${a.disposition}${a.flags.length ? ` · ${a.flags.join(", ")}` : ""}${a.embedder ? "" : " · lexical tier only"}` });
          this.trace(session, "llmproxy.response", `exfil-guard ${a.disposition} (signal ${a.signal.toFixed(2)})`);
        } catch (e) { out.push({ kind, order, verdict: "block", evidence: `Assessment failed: ${(e as { code?: string }).code ?? (e as Error).message}` }); }
        continue;
      }
      const info = filterInfo(kind);
      out.push({ kind, order, verdict: info && !info.supported ? "unsupported" : "skipped", evidence: info ? info.reference : "Unknown filter." });
    }
    return out;
  }

  private session(pipelineId: string, sessionId: string): LiveSession {
    const s = this.sessions.get(sessionId);
    if (!s || s.pipelineId !== pipelineId) throw new StudioError("NOT_FOUND", 404, "No such live session.");
    return s;
  }

  async context(pipelineId: string, sessionId: string): Promise<PspContext> {
    const s = this.session(pipelineId, sessionId);
    const current = await s.harness.store.execute(s.harness.actor, { action: "getSession", sessionId: s.id });
    return {
      sessionId: s.id, turn: s.turn, loops: s.loops, node: (current.nodeId as string | undefined) ?? null, nodeVersion: (current.nodeVersion as string | undefined) ?? null,
      decisions: s.decisions, status: String(current.status), stateBytes: Buffer.byteLength(canonicalJson(current.state ?? {}))
    };
  }

  /** The model-visible message for a trigger. Only the initiator's own content goes in. */
  private message(config: PipelineConfig, input: TurnInput): { message: string; summary: string } {
    const initiator = terminals(config).initiator!;
    const trigger = String(initiator.trigger);
    if (trigger === "file") {
      const f = input.file;
      if (!f || typeof f.name !== "string" || !f.name) throw new StudioError("INVALID_REQUEST", 400, "A file trigger needs file.name.");
      const content = typeof f.text === "string" && textLike(f.mediaType, f.name) ? `\n\n${clip(f.text)}` : "";
      const note = content ? "" : " Its content was not extracted; the studio reads text files only.";
      return { message: `A file arrived in ${String(initiator.watch ?? "the watch folder")}: ${f.name} (${f.mediaType ?? "unknown type"}${f.bytes !== undefined ? `, ${f.bytes} bytes` : ""}).${note}${content}`, summary: `file ${f.name}` };
    }
    if (trigger === "email") {
      const m = input.email;
      if (!m || typeof m.body !== "string") throw new StudioError("INVALID_REQUEST", 400, "An email trigger needs email.body.");
      return { message: `From: ${m.from ?? "unknown"}\nTo: ${String(initiator.mailbox ?? "")}\nSubject: ${m.subject ?? ""}\n\n${clip(m.body)}`, summary: `email ${m.subject ?? ""}`.trim() };
    }
    if (trigger === "webhook") {
      const body = input.webhook?.body ?? input.text;
      if (typeof body !== "string") throw new StudioError("INVALID_REQUEST", 400, "A webhook trigger needs webhook.body.");
      return { message: `${input.webhook?.method ?? "POST"} ${String(initiator.route ?? "/")}\n\n${clip(body)}`, summary: `webhook ${String(initiator.route ?? "")}` };
    }
    if (trigger === "schedule") {
      const text = typeof input.text === "string" && input.text ? input.text : String(initiator.prompt ?? "");
      return { message: clip(text), summary: "scheduled run" };
    }
    if (typeof input.text !== "string" || !input.text.trim()) throw new StudioError("INVALID_REQUEST", 400, "A chat turn needs text.");
    return { message: clip(input.text), summary: "chat message" };
  }

  /** One request through the ring. The tool loop inside it shows up only in `toolLoop`. */
  async turn(pipelineId: string, sessionId: string, input: TurnInput, onTrace?: (entry: TraceEntry) => void): Promise<PipelineRunRecord> {
    const s = this.session(pipelineId, sessionId);
    if (s.busy) throw new StudioError("TURN_IN_PROGRESS", 409, "A turn is already running in this session.");
    const { message, summary } = this.message(s.config, input ?? {});
    s.busy = true; s.lastUsed = Date.now(); s.onTrace = onTrace;
    s.trace = []; s.calls = []; s.finalVerdicts = null; s.turn++;
    s.box.turn = s.turn; s.box.message = message;
    const { initiator } = terminals(s.config);
    const proxy = primaryProxy(s.config)!;
    const reply = replyMode(initiator);
    const loopsBefore = s.loops;
    let text = "", error: PipelineRunRecord["error"] | undefined;
    try {
      this.trace(s, "initiator", `${String(initiator!.trigger)} → ${summary}`);
      this.trace(s, "llmproxy.request", `prompt signed and bound to session ${s.id.slice(0, 8)}; ${s.registrations.allowed.length} registration(s)`);
      if (s.providerKind === "anthropic") throw Object.assign(new Error("The reference loop has no TypeScript Anthropic adapter."), { code: "UNSUPPORTED_PROVIDER" });
      const { harness } = s;
      const current = await harness.store.execute(harness.actor, { action: "getSession", sessionId: s.id });
      const controls = { deadline: harness.clock.now() + TURN_SECONDS, cancelled: () => false, maxSteps: 8 };
      const result = harness.loop instanceof DurableLlmLoop
        ? await harness.loop.run(OPERATOR_TOKEN, s.id, { message }, { ...controls, requestId: `turn-${s.turn}`, expectedVersion: current.version as number })
        : await (harness.loop as BufferedLlmLoop).run(OPERATOR_TOKEN, s.id, { message }, controls);
      text = typeof result.text === "string" ? result.text : "";
    } catch (e) {
      const code = (e as { code?: string }).code ?? "TURN_FAILED";
      error = { code, ...(e instanceof LockdownError ? { message: "The session is locked after completion." } : (e as Error).message && (e as Error).message !== code ? { message: (e as Error).message } : {}) };
      this.trace(s, "llmproxy.response", `turn ended: ${code}`);
    } finally { s.busy = false; s.onTrace = undefined; }

    // Response filters in slot order. Covenant Gate is the loop's release phase, which runs before authorizeFinal.
    // Filled by authorizeFinal during the loop, which control-flow analysis cannot see.
    const finalVerdicts = s.finalVerdicts as PipelineRunRecord["responseFilters"] | null;
    const reached = !error || error.code === "COMPLETION_DENIED" || error.code === "OUTPUT_DENIED";
    const filters: PipelineRunRecord["responseFilters"] = [];
    for (const [order, spec] of filtersOf(proxy, "response").entries()) {
      const kind = filterKind(spec);
      if (kind === "covenant-gate") {
        filters.push({ kind, order, verdict: error?.code === "OUTPUT_DENIED" ? "block" : reached ? "pass" : "skipped", evidence: error?.code === "OUTPUT_DENIED" ? `The release phase denied the ${String(initiator?.trigger)} sink.` : "Release phase against the sink's capabilities." });
        continue;
      }
      const verdict = finalVerdicts?.find(v => v.order === order);
      filters.push(verdict ?? { kind, order, verdict: "skipped", evidence: reached && error?.code === "OUTPUT_DENIED" ? "Not reached: the release phase denied the reply first." : "Not reached." });
    }

    // Delivery through the sink.
    let delivery: PipelineRunRecord["delivery"] = reply === "none" ? "none" : error ? "withheld" : "delivered";
    let deliveredTo: string | undefined;
    if (delivery === "delivered" && initiator) {
      const trigger = String(initiator.trigger);
      if (trigger === "file") {
        const name = (input.file?.name ?? "reply").replace(/[\\/]/g, "_").replace(/\.[^.]*$/, "");
        const target = posix.join(String(initiator.output ?? "out").replace(/\/+$/, ""), `${name}.reply.md`);
        try { this.options.services.workspace.write(target, text || "(empty reply)"); deliveredTo = target; }
        catch (e) { delivery = "withheld"; error = { code: (e as { code?: string }).code ?? "DELIVERY_FAILED", message: (e as Error).message }; }
        if (input.file?.path) this.finishQueued(input.file.path, String(initiator.onDone ?? "keep"));
      } else if (trigger === "email") { delivery = "withheld"; deliveredTo = "The studio cannot send email replies."; }
      else deliveredTo = trigger === "webhook" ? "HTTP response" : trigger === "schedule" ? "run output" : "chat window";
    }
    this.trace(s, "initiator", delivery === "none" ? "recorded, not delivered" : delivery === "delivered" ? `delivered to ${deliveredTo}` : "withheld");

    const context = await this.context(pipelineId, s.id);
    const record: PipelineRunRecord = {
      sessionId: s.id, turn: s.turn, at: new Date().toISOString(), input: { trigger: String(initiator?.trigger), summary },
      trace: s.trace, registrations: { allowed: s.registrations.allowed, withheldByNode: s.registrations.withheldByNode, withheldByCovenant: s.registrations.withheldByCovenant, withheldByMode: s.registrations.withheldByMode, ...(s.registrations.unsupported ? { unsupported: s.registrations.unsupported } : {}) },
      toolLoop: { turns: s.loops - loopsBefore, calls: s.calls }, responseFilters: filters,
      reply: delivery === "delivered" || delivery === "none" ? text : "", delivery, ...(deliveredTo ? { deliveredTo } : {}), ...(error ? { error } : {}),
      taps: this.taps(s, message, text, filters, delivery, error), context
    };
    return record;
  }

  /** Auxiliary taps: JSON Lines records, redacted while a covenant in context forbids logging. */
  private taps(s: LiveSession, message: string, text: string, filters: PipelineRunRecord["responseFilters"], delivery: string, error?: { code: string }): PipelineRunRecord["taps"] {
    const out: PipelineRunRecord["taps"] = [];
    const context = { covenants: s.psp?.summary.covenants ?? [], classes: s.psp?.summary.classes ?? [] };
    for (const aux of s.config.components.filter(c => (c.kind === "logger" || c.kind === "otel") && attachment(s.config, c) === "tap")) {
      if (aux.kind === "otel") { out.push({ id: aux.id, kind: aux.kind, status: "unsupported", detail: "The studio has no OpenTelemetry exporter." }); continue; }
      const term = conflictingTerm(context, TAP_CAPABILITIES[aux.kind] ?? []);
      const redacted = term !== null;
      const hide = (value: string) => redacted ? { redacted: true, sha256: digest(value), bytes: Buffer.byteLength(value) } : value;
      try {
        const dir = pipelinePath(this.options.dataDir, s.pipelineId, typeof aux.sink === "string" ? aux.sink : "./runs/");
        mkdirSync(dir, { recursive: true });
        appendFileSync(join(dir, `${s.id}.jsonl`), JSON.stringify({
          at: new Date().toISOString(), pipelineId: s.pipelineId, sessionId: s.id, turn: s.turn, input: hide(message), reply: hide(text), delivery,
          filters: filters.map(f => ({ kind: f.kind, verdict: f.verdict })), tools: s.calls.map(c => ({ tool: c.tool, outcome: c.outcome })), ...(error ? { error: error.code } : {})
        }) + "\n", "utf8");
        out.push({ id: aux.id, kind: aux.kind, status: redacted ? "redacted" : "written", ...(redacted ? { detail: `${term} is in context${aux.redact === "none" ? "; redacted although redact is none" : ""}.` } : {}) });
      } catch (e) { out.push({ id: aux.id, kind: aux.kind, status: "skipped", detail: (e as Error).message }); }
    }
    return out;
  }

  /** Applies onDone to a queued workspace file. Paths are checked by the workspace. */
  private finishQueued(path: string, onDone: string): void {
    const { workspace } = this.options.services;
    try {
      const absolute = workspace.resolve(path);
      if (onDone === "delete") unlinkSync(absolute);
      if (onDone === "move") {
        const parts = path.split("/"), name = parts.pop()!;
        const target = workspace.resolve([...parts, "done", name].join("/"));
        mkdirSync(dirname(target), { recursive: true });
        renameSync(absolute, target);
      }
    } catch { /* The queue is a convenience; a missing file is not a turn failure. */ }
  }

  /** Workspace files a file trigger would pick up. */
  queue(pipelineId: string): { watch: string | null; files: { path: string; bytes: number; modifiedAt: string }[] } {
    const config = this.options.store.get(pipelineId).config;
    const watch = terminals(config).initiator?.watch;
    if (typeof watch !== "string" || !watch) return { watch: null, files: [] };
    const pattern = globRegExp(watch);
    return { watch, files: this.options.services.workspace.list().filter(f => pattern.test(f.path) && !f.path.split("/").includes("done")) };
  }

  /** Read-only status of a vector store: what Exfil Guard would read. Never writes. */
  vectorStatus(pipelineId: string, storeId: string): Record<string, unknown> {
    const config = this.options.store.get(pipelineId).config;
    const store = config.components.find(c => c.id === storeId && c.kind === "vector-store");
    if (!store) throw new StudioError("NOT_FOUND", 404, "No such vector store in this pipeline.");
    const path = pipelinePath(this.options.dataDir, pipelineId, String(store.path));
    const embedding = typeof store.embedding === "string" ? store.embedding : HASH_EMBEDDER_ID;
    const base = { storeId, engine: store.engine ?? "portable", embedding, available: this.embedders().includes(embedding), dims: store.dims ?? null };
    if (!existsSync(path)) return { ...base, exists: false, applications: [], sections: 0, chunks: 0 };
    const db = new DatabaseSync(path, { readOnly: true });
    try {
      const meta = Object.fromEntries((db.prepare("SELECT name, value FROM exfil_meta").all() as { name: string; value: string }[]).map(r => [r.name, r.value]));
      const rows = db.prepare("SELECT application, section_type, count(*) AS sections, sum(chunk_count) AS chunks, sum(token_count) AS tokens FROM exfil_section GROUP BY application, section_type ORDER BY application").all() as { application: string; section_type: string; sections: number; chunks: number; tokens: number }[];
      return {
        ...base, exists: true, profile: meta.profile ?? null, storedEmbedder: meta.embedder ?? null,
        applications: rows.map(r => ({ application: r.application, sectionType: r.section_type, sections: Number(r.sections), chunks: Number(r.chunks ?? 0), tokens: Number(r.tokens ?? 0) })),
        sections: rows.reduce((n, r) => n + Number(r.sections), 0), chunks: rows.reduce((n, r) => n + Number(r.chunks ?? 0), 0)
      };
    } catch (e) { return { ...base, exists: true, error: (e as Error).message, applications: [], sections: 0, chunks: 0 }; }
    finally { db.close(); }
  }

  async close(sessionId: string): Promise<void> {
    const s = this.sessions.get(sessionId);
    if (!s) return;
    this.sessions.delete(sessionId);
    try { if (s.exfil) { s.exfil.removeSession(s.application, s.id); s.exfil.close(); } } catch { /* best effort */ }
    for (const c of s.clients) await c.close().catch(() => {});
    s.harness.close();
    rmSync(s.dir, { recursive: true, force: true });
  }
  async closePipeline(pipelineId: string): Promise<void> { for (const s of [...this.sessions.values()]) if (s.pipelineId === pipelineId) await this.close(s.id); }
  async shutdown(): Promise<void> { clearInterval(this.sweeper); for (const id of [...this.sessions.keys()]) await this.close(id); }
}

/**
 * Asks the reference gate whether it would register one tool, so one unsupported schema excludes that
 * tool instead of failing the session. The gate's own validation decides; nothing is reimplemented.
 */
function admission(registration: ToolRegistration): string | null {
  const host = { authenticate: () => null, now: () => 0, snapshot: () => ({}), policy: () => ({}) } as unknown as ConstructorParameters<typeof McpDispatchGate>[1];
  try { new McpDispatchGate({ coordinator: new OwnerCoordinator() } as unknown as ConstructorParameters<typeof McpDispatchGate>[0], host, "admission", [registration]); return null; }
  catch (e) { return (e as { code?: string }).code ?? "INVALID_CONFIGURATION"; }
}

/** Offline provider: replays the configured script per turn, or answers with an echo. Never calls a network. */
export function mockProvider(model: Component, turn: () => number, message: () => string): ProviderRegistration {
  const script = Array.isArray(model.script) ? model.script as ScriptedReply[][] : null;
  let current = -1, index = 0;
  return {
    id: "mock", revision: script ? "script-1" : "echo-1", sources: [{ id: "provider", capabilities: [] }], complete: true,
    invoke: async () => {
      if (current !== turn()) { current = turn(); index = 0; }
      if (!script) return index++ === 0 ? { type: "final", text: `Echo: ${message()}` } : (() => { throw new Error("SCRIPT_EXHAUSTED"); })();
      const reply = script[turn() - 1]?.[index++];
      if (!reply) throw new Error("SCRIPT_EXHAUSTED");
      return structuredClone(reply);
    }
  };
}
