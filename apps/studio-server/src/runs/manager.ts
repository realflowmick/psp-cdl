// SPDX-License-Identifier: Apache-2.0
import { randomBytes } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { isTerminal, type EngineEvent, type EngineKind, type RunRecord, type RunStatus, type RunSummary, type StudioEvent } from "@psp-cdl/studio-core";
import { StudioError } from "../http/router.js";

export interface RunInput { engine: EngineKind; scenarioId: string; collectionId?: string; label: string; inspect: boolean }
export interface RunHandle {
  runId: string; artifactDir: string; inspect: boolean; signal: AbortSignal;
  emit(event: EngineEvent): void;
  cancelled(): boolean;
}
export type Executor = (handle: RunHandle) => Promise<RunSummary>;
const MAX_EVENT_BYTES = 4 * 1024 * 1024;
const MAX_RUNS_LISTED = 500;

/** Owns run records and their event journals. Engines only see a RunHandle. */
export class RunManager {
  private readonly dir: string;
  private readonly runs = new Map<string, RunRecord>();
  private readonly controllers = new Map<string, AbortController>();
  private readonly eventListeners = new Set<(event: StudioEvent) => void>();
  private readonly statusListeners = new Set<(record: RunRecord) => void>();
  constructor(dataDir: string) {
    this.dir = join(dataDir, "runs");
    mkdirSync(this.dir, { recursive: true });
    for (const name of readdirSync(this.dir)) {
      const file = join(this.dir, name, "run.json");
      if (!existsSync(file)) continue;
      try {
        const record = JSON.parse(readFileSync(file, "utf8")) as RunRecord;
        if (!isTerminal(record.status)) {
          // The server restarted while this run was active; nothing can resume it.
          record.status = "failed"; record.finishedAt = new Date().toISOString(); record.error = { code: "INTERRUPTED", message: "The studio server stopped while this run was active." };
          this.save(record);
        }
        this.runs.set(record.runId, record);
      } catch { /* Unreadable run directories are ignored rather than crashing the server. */ }
    }
  }
  private save(record: RunRecord): void {
    const file = join(record.artifactDir, "run.json"), temporary = `${file}.${process.pid}.tmp`;
    writeFileSync(temporary, JSON.stringify(record, null, 2) + "\n", "utf8");
    renameSync(temporary, file);
  }
  private update(record: RunRecord, patch: Partial<RunRecord>): RunRecord {
    Object.assign(record, patch);
    this.save(record);
    for (const listener of this.statusListeners) { try { listener(structuredClone(record)); } catch { /* listeners never affect the run */ } }
    return record;
  }
  list(): RunRecord[] {
    return [...this.runs.values()].sort((a, b) => a.startedAt < b.startedAt ? 1 : -1).slice(0, MAX_RUNS_LISTED).map(r => structuredClone(r));
  }
  get(runId: string): RunRecord {
    const record = this.runs.get(runId);
    if (!record) throw new StudioError("NOT_FOUND", 404, "No such run.");
    return structuredClone(record);
  }
  active(): number { return [...this.runs.values()].filter(r => !isTerminal(r.status)).length; }
  create(input: RunInput): RunRecord {
    const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
    const runId = `${stamp}-${randomBytes(3).toString("hex")}`;
    const artifactDir = join(this.dir, runId);
    mkdirSync(artifactDir, { recursive: false });
    const record: RunRecord = { runId, scenarioId: input.scenarioId, engine: input.engine, label: input.label, status: "queued", startedAt: new Date().toISOString(), lastSeq: 0, inspect: input.inspect, artifactDir, ...(input.collectionId ? { collectionId: input.collectionId } : {}) };
    this.runs.set(runId, record);
    this.controllers.set(runId, new AbortController());
    this.save(record);
    return structuredClone(record);
  }
  private append(record: RunRecord, event: EngineEvent): StudioEvent {
    const full: StudioEvent = { runId: record.runId, seq: record.lastSeq + 1, at: new Date().toISOString(), engine: record.engine, ...event };
    let line = JSON.stringify(full);
    if (Buffer.byteLength(line) > MAX_EVENT_BYTES) {
      line = JSON.stringify({ ...full, data: { truncated: true, bytes: Buffer.byteLength(line) } });
    }
    appendFileSync(join(record.artifactDir, "events.jsonl"), line + "\n", "utf8");
    record.lastSeq = full.seq;
    for (const listener of this.eventListeners) { try { listener(full); } catch { /* listeners never affect the run */ } }
    return full;
  }
  private status(record: RunRecord, status: RunStatus, extra: Record<string, unknown> = {}, patch: Partial<RunRecord> = {}): void {
    this.append(record, { source: "studio", type: "studio.run.status", severity: status === "failed" ? "error" : status === "completed" ? "success" : "info", data: { status, ...extra } });
    this.update(record, { ...patch, status });
  }
  /** Runs the executor to completion; every outcome, including a thrown error, lands in the record. */
  async execute(runId: string, executor: Executor): Promise<RunRecord> {
    const record = this.runs.get(runId), controller = this.controllers.get(runId);
    if (!record) throw new StudioError("NOT_FOUND", 404, "No such run.");
    if (!controller || record.status !== "queued") throw new StudioError("INVALID_STATE", 409, "The run already started.");
    const handle: RunHandle = {
      runId, artifactDir: record.artifactDir, inspect: record.inspect, signal: controller.signal,
      emit: event => { if (!isTerminal(record.status)) this.append(record, event); },
      cancelled: () => controller.signal.aborted
    };
    this.status(record, "running");
    let summary: RunSummary;
    try {
      summary = await executor(handle);
    } catch (e) {
      const code = controller.signal.aborted ? "CANCELLED" : typeof (e as { code?: unknown })?.code === "string" ? (e as { code: string }).code : "ENGINE_ERROR";
      const message = e instanceof Error && e.message !== code ? e.message : undefined;
      summary = { status: controller.signal.aborted ? "cancelled" : "failed", summary: {}, error: { code, ...(message ? { message } : {}) } };
    }
    if (controller.signal.aborted && summary.status === "completed") summary = { ...summary, status: "cancelled" };
    this.status(record, summary.status, { ...(summary.error ? { error: summary.error } : {}) }, { summary: summary.summary, ...(summary.error ? { error: summary.error } : {}), finishedAt: new Date().toISOString() });
    this.controllers.delete(runId);
    return structuredClone(record);
  }
  cancel(runId: string): RunRecord {
    const record = this.runs.get(runId), controller = this.controllers.get(runId);
    if (!record) throw new StudioError("NOT_FOUND", 404, "No such run.");
    if (isTerminal(record.status)) return structuredClone(record);
    if (record.status === "queued") {
      // Never started: close it out directly.
      this.status(record, "cancelled", {}, { error: { code: "CANCELLED" }, finishedAt: new Date().toISOString() });
      this.controllers.delete(runId);
      return structuredClone(record);
    }
    if (record.status === "running") { this.status(record, "cancelling"); controller?.abort(); }
    return structuredClone(record);
  }
  /** Replays the journal from a sequence number; the file is the source of truth. */
  events(runId: string, fromSeq = 1, limit = 10_000): StudioEvent[] {
    const record = this.runs.get(runId);
    if (!record) throw new StudioError("NOT_FOUND", 404, "No such run.");
    const file = join(record.artifactDir, "events.jsonl");
    if (!existsSync(file)) return [];
    const out: StudioEvent[] = [];
    for (const line of readFileSync(file, "utf8").split("\n")) {
      if (!line) continue;
      let event: StudioEvent;
      try { event = JSON.parse(line); } catch { continue; }
      if (event.seq < fromSeq) continue;
      out.push(event);
      if (out.length >= limit) break;
    }
    return out;
  }
  onEvent(listener: (event: StudioEvent) => void): () => void { this.eventListeners.add(listener); return () => this.eventListeners.delete(listener); }
  onStatus(listener: (record: RunRecord) => void): () => void { this.statusListeners.add(listener); return () => this.statusListeners.delete(listener); }
}
