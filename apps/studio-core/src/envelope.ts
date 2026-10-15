// SPDX-License-Identifier: Apache-2.0
/** Normalized run event envelope shared by the studio server and the browser. */
export type EngineKind = "live-loop" | "campaign" | "joint" | "study" | "heldout";
export type EventSource = "llmproxy" | "mcpproxy" | "provider" | "campaign" | "joint" | "study" | "heldout" | "studio";
export type Severity = "info" | "success" | "warn" | "error";
export type RunStatus = "queued" | "preparing" | "running" | "cancelling" | "completed" | "failed" | "cancelled";

export interface StudioEvent {
  runId: string;
  /** Assigned by the run manager; strictly increasing per run, starting at 1. */
  seq: number;
  /** ISO-8601 wall-clock time at which the server recorded the event. */
  at: string;
  engine: EngineKind;
  source: EventSource;
  /** Observer type (for example `cdl.decision`) or studio type (for example `studio.run.status`). */
  type: string;
  severity: Severity;
  episode?: string;
  caseId?: string;
  condition?: string;
  language?: string;
  turn?: number;
  step?: number;
  round?: number;
  data: Record<string, unknown>;
}

/** What an engine hands the run manager; the manager completes runId, seq, at and engine. */
export type EngineEvent = Omit<StudioEvent, "runId" | "seq" | "at" | "engine">;

export interface RunRecord {
  runId: string;
  collectionId?: string;
  scenarioId: string;
  engine: EngineKind;
  label: string;
  status: RunStatus;
  startedAt: string;
  finishedAt?: string;
  lastSeq: number;
  /** Inspect level attaches model-visible payloads to events; shown as a banner in the UI. */
  inspect: boolean;
  /** Directory holding run.json, events.jsonl and engine artifacts. */
  artifactDir: string;
  summary?: Record<string, unknown>;
  error?: { code: string; message?: string };
}

export interface PreparedRun {
  engine: EngineKind;
  scenarioId: string;
  /** Engine-specific preview: budget reservation, planned trials, case list, host construction report. */
  preview: Record<string, unknown>;
  /** Digest an operator must repeat to admit a live run, when the engine requires admission. */
  admissionDigest?: string;
  warnings: string[];
}

export interface RunSummary {
  status: "completed" | "failed" | "cancelled";
  summary: Record<string, unknown>;
  error?: { code: string; message?: string };
}

const TERMINAL: ReadonlySet<RunStatus> = new Set<RunStatus>(["completed", "failed", "cancelled"]);
export function isTerminal(status: RunStatus): boolean { return TERMINAL.has(status); }

/** Severity for an observer event; the viewer colours by this, nothing else depends on it. */
export function classifyObserverEvent(type: string, data: Record<string, unknown>): Severity {
  if (type.endsWith(".failed") || type === "lockdown") return "error";
  if (type === "cdl.decision") return data.decision === "allow" ? "info" : "error";
  if ((type === "dispatch.guard" || type === "inference.end" || type === "tool.invoke.end") && data.ok === false) return "error";
  if (type === "service.result" && data.event === "service-denied") return "warn";
  if (type === "refresh.due" || type === "prompt.replaced" || type === "checkpoint.waiting") return "warn";
  if (["turn.buffered", "turn.committed", "turn.released", "turn.recovered", "dispatch.released", "final.authorized", "round.answer"].includes(type)) return "success";
  return "info";
}
