// SPDX-License-Identifier: Apache-2.0
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve, sep } from "node:path";
import type { CampaignScenario, EngineEvent, HeldoutScenario, JointScenario, PreparedRun, RunSummary, Scenario, StudyScenario } from "@psp-cdl/studio-core";
import { EngineError, type Engine, type EngineContext, type EngineServices, type PrepareContext } from "./types.js";

export type PythonScenario = CampaignScenario | JointScenario | StudyScenario | HeldoutScenario;
export type Launcher = (script: string, args: string[]) => string[];
/** `uv run --locked python <script>`; tests substitute a fake launcher. */
export const uvLauncher = (uv: string): Launcher => (script, args) => [uv, "run", "--locked", "python", script, ...args];
const CREDENTIAL_ENV = /KEY|TOKEN|SECRET|PASSWORD|PASSPHRASE/i;
const MAX_LINE = 16 * 1024, MAX_LINES = 5000, POLL_MS = 400;
/** Raw evidence stays in the journal file; the event stream keeps the compact fields the analyzers keep. */
const STRIP = new Set(["system", "messages", "text", "released", "state", "receipts", "input", "attackPayload", "observation", "trace"]);

interface ProcessResult { code: number; stdout: string; stderr: string; lastJson: Record<string, unknown> | null }
interface StepOptions { label: string; env?: Record<string, string>; onCancel?: () => void; watch?: Watcher }
interface Watcher { poll(): void; close(): void }

function compact(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { value };
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).filter(([k]) => !STRIP.has(k)));
}
function lastJsonLine(text: string): Record<string, unknown> | null {
  for (const line of text.trim().split("\n").reverse()) {
    try { const v = JSON.parse(line); if (v && typeof v === "object" && !Array.isArray(v)) return v; } catch { /* keep looking */ }
  }
  return null;
}
function baseEnv(services: EngineServices, extra: Record<string, string>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && !CREDENTIAL_ENV.test(k)) env[k] = v;
  env.PYTHONIOENCODING = "utf-8"; env.PYTHONUTF8 = "1";
  return { ...env, ...extra };
}
function repoPath(services: EngineServices, value: string, field: string): string {
  if (typeof value !== "string" || !value.length || value.includes("\0")) throw new EngineError("INVALID_PATH", `${field} must be a repository-relative path.`);
  const absolute = resolve(services.repoRoot, value), rel = relative(services.repoRoot, absolute);
  if (!rel || rel.startsWith("..") || rel.includes(`..${sep}`)) throw new EngineError("INVALID_PATH", `${field} must stay inside the repository.`);
  if (!existsSync(absolute)) throw new EngineError("NOT_FOUND", `${field}: ${value} does not exist.`);
  return absolute;
}
function requireArtifacts(services: EngineServices, dir: string, engine: string): void {
  const root = resolve(services.repoRoot, ".artifacts"), rel = relative(root, resolve(dir));
  if (!rel || rel.startsWith("..")) throw new EngineError("UNSUPPORTED_DATA_DIR", `The ${engine} engine only writes under the repository's .artifacts directory; start the studio server with --data inside .artifacts.`);
}

/** Tails one JSONL file; each complete new line becomes an event. */
export function jsonlWatcher(file: string, type: string, emit: (event: EngineEvent) => void): Watcher {
  let offset = 0, partial = "";
  const poll = () => {
    if (!existsSync(file)) return;
    const size = statSync(file).size;
    if (size <= offset) return;
    const chunk = readFileSync(file, "utf8").slice(offset);
    offset = size;
    const lines = (partial + chunk).split("\n");
    partial = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      try { emit({ source: "campaign", type, severity: "info", data: compact(JSON.parse(line)) }); }
      catch { emit({ source: "campaign", type: `${type}.unparsed`, severity: "warn", data: { bytes: Buffer.byteLength(line) } }); }
    }
  };
  return { poll, close: poll };
}
/** Polls a JSON document that an engine rewrites, emitting rows of one array field as they appear. */
export function jsonArrayWatcher(file: string, field: string, source: EngineEvent["source"], type: string, emit: (event: EngineEvent) => void): Watcher {
  let seen = 0;
  const poll = () => {
    if (!existsSync(file)) return;
    let doc: Record<string, unknown>;
    try { doc = JSON.parse(readFileSync(file, "utf8")); } catch { return; }
    const rows = doc[field];
    if (!Array.isArray(rows)) return;
    for (; seen < rows.length; seen++) emit({ source, type, severity: "info", data: compact(rows[seen]) });
  };
  return { poll, close: poll };
}
/** Emits each new file matching a suffix in a directory; used for per-case grade files. */
export function directoryWatcher(dir: string, suffix: string, source: EngineEvent["source"], type: string, emit: (event: EngineEvent) => void): Watcher {
  const seen = new Set<string>();
  const poll = () => {
    if (!existsSync(dir)) return;
    for (const name of readdirSync(dir).sort()) {
      if (!name.endsWith(suffix) || seen.has(name)) continue;
      seen.add(name);
      try { emit({ source, type, severity: "info", data: { file: name, ...compact(JSON.parse(readFileSync(join(dir, name), "utf8"))) } }); }
      catch { emit({ source, type, severity: "warn", data: { file: name, unparsed: true } }); }
    }
  };
  return { poll, close: poll };
}

/** Runs one engine command, streaming its output lines as events and polling a journal watcher. */
export function runStep(services: EngineServices, context: Pick<EngineContext, "emit" | "cancelled" | "signal">, command: string[], options: StepOptions): Promise<ProcessResult> {
  return new Promise((resolvePromise, reject) => {
    const [file, ...args] = command;
    if (!file) return reject(new EngineError("INVALID_COMMAND"));
    context.emit({ source: "studio", type: "studio.process.start", severity: "info", data: { label: options.label, command: command.map(c => relative(services.repoRoot, c) || c).slice(0, 12) } });
    const child = spawn(file, args, { cwd: services.repoRoot, env: baseEnv(services, options.env ?? {}), stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    let stdout = "", stderr = "", lines = 0, killTimer: NodeJS.Timeout | undefined;
    const stream = (name: "stdout" | "stderr", chunk: Buffer) => {
      const text = chunk.toString("utf8");
      if (name === "stdout") stdout = (stdout + text).slice(-262_144); else stderr = (stderr + text).slice(-65_536);
      for (const line of text.split(/\r?\n/)) {
        if (!line.trim() || lines >= MAX_LINES) continue;
        lines++;
        context.emit({ source: "studio", type: `studio.process.${name}`, severity: name === "stderr" ? "warn" : "info", data: { label: options.label, line: line.slice(0, MAX_LINE) } });
      }
    };
    child.stdout.on("data", (c: Buffer) => stream("stdout", c));
    child.stderr.on("data", (c: Buffer) => stream("stderr", c));
    const timer = setInterval(() => { try { options.watch?.poll(); } catch { /* watcher errors never stop the process */ } }, POLL_MS);
    const onAbort = () => {
      context.emit({ source: "studio", type: "studio.process.cancel", severity: "warn", data: { label: options.label, graceful: !!options.onCancel } });
      try { options.onCancel?.(); } catch { /* fall through to the kill */ }
      killTimer = setTimeout(() => { try { child.kill(); } catch { /* exited already */ } }, options.onCancel ? 15_000 : 0);
    };
    if (context.signal.aborted) onAbort(); else context.signal.addEventListener("abort", onAbort, { once: true });
    const finish = (code: number | null, error?: Error) => {
      clearInterval(timer); if (killTimer) clearTimeout(killTimer);
      context.signal.removeEventListener("abort", onAbort);
      try { options.watch?.close(); } catch { /* ignore */ }
      const result: ProcessResult = { code: code ?? -1, stdout, stderr, lastJson: lastJsonLine(stdout) };
      context.emit({ source: "studio", type: "studio.process.exit", severity: result.code === 0 ? "success" : "error", data: { label: options.label, code: result.code, ...(error ? { error: error.message } : {}) } });
      if (error) return reject(new EngineError("PROCESS_FAILED", `${options.label}: ${error.message}`));
      if (context.signal.aborted) return reject(new EngineError("CANCELLED"));
      if (result.code !== 0) {
        const detail = (result.lastJson?.error ?? result.lastJson?.code ?? stderr.trim().split("\n").slice(-3).join(" | ")) as string;
        return reject(new EngineError("PROCESS_FAILED", `${options.label} exited with ${result.code}${detail ? `: ${String(detail).slice(0, 500)}` : ""}`));
      }
      resolvePromise(result);
    };
    child.on("error", e => finish(null, e));
    child.on("close", code => finish(code));
  });
}

function scratch(prefix: string): { dir: string; done(): void } {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  return { dir, done: () => rmSync(dir, { recursive: true, force: true }) };
}
const readJson = (file: string): Record<string, unknown> => JSON.parse(readFileSync(file, "utf8"));
const credentialEnv = (services: EngineServices, live: boolean): Record<string, string> => {
  if (!live) return {};
  const env: Record<string, string> = {};
  const openai = services.vault.get("openai.apiKey"), anthropic = services.vault.get("anthropic.apiKey");
  if (openai) env.PSP_OPENAI_API_KEY = openai;
  if (anthropic) env.ANTHROPIC_API_KEY = anthropic;
  return env;
};

/** Drives the existing Python evaluation engines as subprocesses and tails their journals. */
export class PythonEngine implements Engine<PythonScenario> {
  constructor(readonly kind: PythonScenario["kind"], private readonly launcher: Launcher) {}
  private command(script: string, args: string[]): string[] { return this.launcher(script, args); }
  private quiet(context: PrepareContext): Pick<EngineContext, "emit" | "cancelled" | "signal"> { void context; return { emit: () => {}, cancelled: () => false, signal: new AbortController().signal }; }

  async prepare(scenario: PythonScenario, context: PrepareContext): Promise<PreparedRun> {
    const warnings: string[] = [];
    const base = { engine: scenario.kind, scenarioId: scenario.id } as const;
    const s = scratch("psp-studio-prepare-");
    try {
      if (scenario.kind === "campaign") {
        const config = join(s.dir, "config.json");
        writeFileSync(config, JSON.stringify(campaignConfig(scenario), null, 2));
        const result = await runStep(context, this.quiet(context), this.command("scripts/campaign.py", ["prepare", "--config", config, "--output", join(s.dir, "bundle.json")]), { label: "campaign prepare" });
        const info = result.lastJson ?? {};
        if (scenario.live) {
          warnings.push("Live collection spends provider budget; the admission digest must be repeated to start it.");
          for (const role of Object.values((scenario.config.roles ?? {}) as Record<string, { provider?: string }>)) {
            const name = role.provider === "anthropic" ? "anthropic.apiKey" : "openai.apiKey";
            if (!context.vault.has(name)) warnings.push(`${name} is not stored in the vault; the live run will fail with CREDENTIAL_MISSING.`);
          }
        }
        return { ...base, preview: { episodes: info.episodes ?? null, reservation: info, live: !!scenario.live, pairIds: scenario.pairIds ?? null }, ...(scenario.live ? { admissionDigest: String(info.sha256 ?? "") } : {}), warnings };
      }
      if (scenario.kind === "joint") {
        const args = ["prepare", "--output", join(s.dir, "bundle.json"), ...(scenario.caseIds ?? []).flatMap(id => ["--case", id])];
        const result = await runStep(context, this.quiet(context), this.command("scripts/joint_interpreter.py", args), { label: "joint prepare" });
        const info = result.lastJson ?? {};
        if (scenario.mode === "live" && !context.vault.has("openai.apiKey")) warnings.push("openai.apiKey is not stored in the vault; the live run will fail.");
        return { ...base, preview: { cases: info.cases ?? null, language: scenario.language, mode: scenario.mode, bundleDigest: info.bundleDigest ?? null }, ...(scenario.mode === "live" ? { admissionDigest: String(info.bundleDigest ?? "") } : {}), warnings };
      }
      if (scenario.kind === "study") {
        if (scenario.mode === "live") throw new EngineError("UNSUPPORTED_MODE", "Live studies require the budget and provider-capability review flags; run scripts/run-study.py from the CLI as STUDY-RUNNER.md describes.");
        requireArtifacts(context, s.dir.startsWith(resolve(context.repoRoot, ".artifacts")) ? s.dir : join(context.repoRoot, ".artifacts", "studio-prepare"), "study");
        const output = join(context.repoRoot, ".artifacts", "studio-prepare", `plan-${Date.now()}-${process.pid}.json`);
        mkdirSync(join(context.repoRoot, ".artifacts", "studio-prepare"), { recursive: true });
        try {
          const result = await runStep(context, this.quiet(context), this.command("scripts/run-study.py", [...studyArgs(scenario), "--plan-only", "--output", output]), { label: "study plan" });
          return { ...base, preview: { ...(result.lastJson ?? {}), mode: scenario.mode }, warnings };
        } finally { rmSync(output.replace(/\.json$/, ".plan.json"), { force: true }); }
      }
      if (scenario.mode === "live") throw new EngineError("UNSUPPORTED_MODE", "Live held-out execution needs a reviewed operator admission file; run scripts/run-heldout.py from the CLI as HELDOUT-EXECUTOR.md describes.");
      const plan = repoPath(context, scenario.plan, "plan"), corpus = repoPath(context, scenario.corpus, "corpus");
      const planned = join(s.dir, "plan.json");
      await runStep(context, this.quiet(context), [process.execPath, join(context.repoRoot, "scripts", "pilot.mjs"), "plan", "--request", plan, "--output", planned], { label: "heldout plan" });
      const result = await runStep(context, this.quiet(context), this.command("scripts/run-heldout.py", ["prepare", "--plan", planned, "--corpus", corpus, "--rehearsal", rehearsalFile(context), "--output", join(s.dir, "bundle.json")]), { label: "heldout prepare" });
      return { ...base, preview: { ...(result.lastJson ?? {}), mode: scenario.mode }, warnings };
    } finally { s.done(); }
  }

  async run(scenario: PythonScenario, context: EngineContext): Promise<RunSummary> {
    const dir = context.artifactDir;
    if (scenario.kind === "campaign") {
      const config = join(dir, "config.json"), bundle = join(dir, "bundle.json"), collection = join(dir, "collection");
      writeFileSync(config, JSON.stringify(campaignConfig(scenario), null, 2));
      const prepared = await runStep(context, context, this.command("scripts/campaign.py", ["prepare", "--config", config, "--output", bundle]), { label: "campaign prepare" });
      const digest = String(prepared.lastJson?.sha256 ?? "");
      if (scenario.live && context.admissionDigest !== digest) throw new EngineError("NOT_ADMITTED", "The admission digest does not match the prepared bundle.");
      const args = ["run", "--bundle", bundle, "--output", collection, ...(scenario.live ? ["--live", "--admit-digest", digest] : [])];
      const watch = jsonlWatcher(join(collection, "journal.jsonl"), "campaign.record", context.emit);
      const ran = await runStep(context, context, this.command("scripts/campaign.py", args), { label: "campaign run", env: credentialEnv(context, !!scenario.live), watch, onCancel: () => { try { mkdirSync(collection, { recursive: true }); writeFileSync(join(collection, "CANCEL"), ""); } catch { /* the kill follows */ } } });
      await runStep(context, context, this.command("scripts/campaign.py", ["analyze", "--input", collection]), { label: "campaign analyze" });
      const summary = existsSync(join(collection, "summary.json")) ? readJson(join(collection, "summary.json")) : {};
      const manifest = existsSync(join(collection, "manifest.json")) ? readJson(join(collection, "manifest.json")) : {};
      return { status: "completed", summary: { run: ran.lastJson ?? {}, manifest, groups: summary.groups ?? null, episodes: Array.isArray(summary.episodes) ? summary.episodes.length : null, collectionMode: summary.collectionMode ?? null } };
    }
    if (scenario.kind === "joint") {
      const bundle = join(dir, "bundle.json"), output = join(dir, "run");
      const prepared = await runStep(context, context, this.command("scripts/joint_interpreter.py", ["prepare", "--output", bundle, ...(scenario.caseIds ?? []).flatMap(id => ["--case", id])]), { label: "joint prepare" });
      const digest = String(prepared.lastJson?.bundleDigest ?? "");
      const live = scenario.mode === "live";
      if (live && context.admissionDigest !== digest) throw new EngineError("NOT_ADMITTED", "The admission digest does not match the prepared bundle.");
      const args = ["run", "--bundle", bundle, "--language", scenario.language, "--output", output, "--mode", scenario.mode, ...(live ? ["--allow-live", "--approved-digest", digest] : [])];
      const watch = directoryWatcher(output, ".grade.json", "joint", "joint.grade", context.emit);
      const ran = await runStep(context, context, this.command("scripts/joint_interpreter.py", args), { label: "joint run", env: credentialEnv(context, live), watch });
      const report = existsSync(join(output, "report.json")) ? readJson(join(output, "report.json")) : {};
      return { status: "completed", summary: { run: ran.lastJson ?? {}, report: compact(report) } };
    }
    if (scenario.kind === "study") {
      if (scenario.mode === "live") throw new EngineError("UNSUPPORTED_MODE", "Live studies run from the CLI only.");
      requireArtifacts(context, dir, "study");
      const output = join(dir, "study.json");
      const watch = jsonArrayWatcher(join(dir, "study.journal.json"), "results", "study", "study.result", context.emit);
      const ran = await runStep(context, context, this.command("scripts/run-study.py", [...studyArgs(scenario), "--output", output]), { label: "study run", watch });
      const report = existsSync(output) ? readJson(output) : {};
      return { status: "completed", summary: { run: ran.lastJson ?? {}, status: report.status ?? null, groups: report.groups ?? null, usage: report.usage ?? null, trials: Array.isArray(report.results) ? report.results.length : null } };
    }
    if (scenario.mode === "live") throw new EngineError("UNSUPPORTED_MODE", "Live held-out execution runs from the CLI only.");
    const plan = repoPath(context, scenario.plan, "plan"), corpus = repoPath(context, scenario.corpus, "corpus"), rehearsal = rehearsalFile(context);
    const planned = join(dir, "plan.json"), bundle = join(dir, "bundle.json");
    await runStep(context, context, [process.execPath, join(context.repoRoot, "scripts", "pilot.mjs"), "plan", "--request", plan, "--output", planned], { label: "heldout plan" });
    await runStep(context, context, this.command("scripts/run-heldout.py", ["prepare", "--plan", planned, "--corpus", corpus, "--rehearsal", rehearsal, "--output", bundle]), { label: "heldout prepare" });
    const watch = directoryWatcher(dir, ".observation.json", "heldout", "heldout.observation", context.emit);
    const ran = await runStep(context, context, this.command("scripts/run-heldout.py", ["run", "--bundle", bundle, "--corpus", corpus, "--rehearsal", rehearsal]), { label: "heldout run", watch });
    const manifestPath = typeof ran.lastJson?.manifest === "string" ? ran.lastJson.manifest : null;
    const manifest = manifestPath && existsSync(manifestPath) ? readJson(manifestPath) : {};
    return { status: "completed", summary: { run: ran.lastJson ?? {}, manifest: compact(manifest) } };
  }
}

function campaignConfig(scenario: CampaignScenario): Record<string, unknown> {
  const config = structuredClone(scenario.config);
  if (scenario.pairIds?.length) config.caseIds = scenario.pairIds.flatMap(id => [`${id}-attack`, `${id}-benign`]);
  return config;
}
function studyArgs(scenario: StudyScenario): string[] {
  return ["--mode", scenario.mode, ...scenario.hosts.flatMap(h => ["--host", h]), ...scenario.peers.flatMap(p => ["--peer", p]), ...scenario.conditions.flatMap(c => ["--condition", c]), ...(scenario.caseIds ?? []).flatMap(c => ["--case", c]), "--repeats", String(scenario.repeats)];
}
function rehearsalFile(services: EngineServices): string {
  return repoPath(services, "conformance/vectors/evaluation/heldout-rehearsal-0.1.json", "rehearsal");
}
export const isPythonScenario = (scenario: Scenario): scenario is PythonScenario => scenario.kind !== "live-loop";
