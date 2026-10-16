// SPDX-License-Identifier: Apache-2.0
import type { RunRecord, Severity, StudioEvent } from "@psp-cdl/studio-core";

export const SOCKET_PATH = "/studio/socket";

/** Minimal socket surface so tests can substitute a fake. */
export interface StudioSocket {
  on(event: string, listener: (...args: any[]) => void): unknown;
  off(event: string, listener: (...args: any[]) => void): unknown;
  emit(event: string, ...args: unknown[]): unknown;
}
export interface ReplayMessage { runId: string; events: StudioEvent[]; done: boolean }

/** Journal order is authoritative: events are keyed by seq, duplicates dropped, gaps kept visible. */
export function mergeEvents(existing: readonly StudioEvent[], incoming: readonly StudioEvent[]): StudioEvent[] {
  if (!incoming.length) return [...existing];
  const bySeq = new Map<number, StudioEvent>();
  for (const e of existing) bySeq.set(e.seq, e);
  for (const e of incoming) if (!bySeq.has(e.seq)) bySeq.set(e.seq, e);
  return [...bySeq.values()].sort((a, b) => a.seq - b.seq);
}
export function lastSeq(events: readonly StudioEvent[]): number { return events.length ? events[events.length - 1]!.seq : 0; }

export interface TurnGroup { turn: number | null; events: StudioEvent[] }
/** Groups consecutive events by turn; events without a turn (run status, process output) stand alone. */
export function groupTurns(events: readonly StudioEvent[]): TurnGroup[] {
  const groups: TurnGroup[] = [];
  for (const e of events) {
    const turn = e.turn ?? null;
    const last = groups[groups.length - 1];
    if (last && last.turn === turn) last.events.push(e); else groups.push({ turn, events: [e] });
  }
  return groups;
}

export interface EventFilter { sources?: ReadonlySet<string>; severities?: ReadonlySet<Severity>; text?: string }
export function filterEvents(events: readonly StudioEvent[], filter: EventFilter): StudioEvent[] {
  const text = filter.text?.trim().toLowerCase() ?? "";
  return events.filter(e =>
    (!filter.sources || filter.sources.has(e.source)) &&
    (!filter.severities || filter.severities.has(e.severity)) &&
    (!text || e.type.toLowerCase().includes(text) || JSON.stringify(e.data).toLowerCase().includes(text)));
}

export interface RunDigest { turns: number; denials: number; failures: number; dispatches: number; lockdown: boolean; lastStatus: string | null }
/** Counts the things an operator scans for first. Purely presentational. */
export function digestRun(events: readonly StudioEvent[]): RunDigest {
  const digest: RunDigest = { turns: 0, denials: 0, failures: 0, dispatches: 0, lockdown: false, lastStatus: null };
  for (const e of events) {
    if (e.type === "studio.turn.start") digest.turns++;
    if (e.type === "cdl.decision" && e.data.decision !== "allow") digest.denials++;
    if (e.type.endsWith(".failed")) digest.failures++;
    if (e.type === "dispatch.released") digest.dispatches++;
    if (e.type === "lockdown") digest.lockdown = true;
    if (e.type === "studio.run.status" && typeof e.data.status === "string") digest.lastStatus = e.data.status;
  }
  return digest;
}

export function latestOfType(events: readonly StudioEvent[], type: string): StudioEvent | undefined {
  for (let i = events.length - 1; i >= 0; i--) if (events[i]!.type === type) return events[i];
  return undefined;
}

/**
 * Subscribes to one run. Replay chunks and live events both flow through `onEvents`; the caller merges
 * with `mergeEvents`, so a reconnect that resubscribes from its last seq never duplicates or loses anything.
 */
export function subscribeRun(socket: StudioSocket, runId: string, fromSeq: number, onEvents: (events: StudioEvent[]) => void, onRecord?: (record: RunRecord) => void): () => void {
  const onReplay = (message: ReplayMessage) => { if (message.runId === runId) onEvents(message.events); };
  const onEvent = (event: StudioEvent) => { if (event.runId === runId) onEvents([event]); };
  const onRun = (record: RunRecord) => { if (record.runId === runId) onRecord?.(record); };
  socket.on("replay", onReplay); socket.on("event", onEvent); socket.on("run", onRun);
  socket.emit("subscribe", { runId, fromSeq }, (reply: { run?: RunRecord; error?: { code: string } }) => { if (reply?.run) onRecord?.(reply.run); });
  return () => {
    socket.off("replay", onReplay); socket.off("event", onEvent); socket.off("run", onRun);
    socket.emit("unsubscribe", { runId });
  };
}

export interface RunTurn {
  turn: number; requestId: string | null; message: string | null; code: string | null; text: string | null;
  sessionVersion: number | null; sessionStatus: string | null; startSeq: number; endSeq: number | null; events: number;
}
const str = (v: unknown): string | null => typeof v === "string" ? v : null;
const num = (v: unknown): number | null => typeof v === "number" ? v : null;
/** Rebuilds the per-turn view from the journal; works for live and finished runs alike. */
export function deriveTurns(events: readonly StudioEvent[]): RunTurn[] {
  const turns = new Map<number, RunTurn>();
  for (const e of events) {
    if (e.turn === undefined) continue;
    let t = turns.get(e.turn);
    if (!t) { t = { turn: e.turn, requestId: null, message: null, code: null, text: null, sessionVersion: null, sessionStatus: null, startSeq: e.seq, endSeq: null, events: 0 }; turns.set(e.turn, t); }
    t.events++;
    t.startSeq = Math.min(t.startSeq, e.seq);
    if (e.type === "studio.turn.start") { t.requestId = str(e.data.requestId); t.message = str(e.data.message); }
    if (e.type === "studio.turn.end") { t.code = str(e.data.code); t.text = str(e.data.text); t.endSeq = e.seq; }
    if (e.type === "studio.session") { t.sessionVersion = num(e.data.version); t.sessionStatus = str(e.data.status); }
  }
  return [...turns.values()].sort((a, b) => a.turn - b.turn);
}

/** One-line hint per event type so a grid row reads without opening the event. */
export function eventSummary(e: StudioEvent): string {
  const d = e.data;
  switch (e.type) {
    case "cdl.decision": return `${String(d.phase)} → ${String(d.decision)}${Array.isArray(d.reasonCodes) && d.reasonCodes.length ? ` (${d.reasonCodes.join(", ")})` : ""}`;
    case "model.candidate": return `${String(d.type)}${d.toolName ? ` ${String(d.toolName)}` : ""}`;
    case "dispatch.requested": case "dispatch.start": case "dispatch.released": case "tool.invoke.start": return String(d.toolName ?? "");
    case "turn.failed": case "durable.failed": case "dispatch.failed": case "context.failed": return String(d.code ?? "");
    case "turn.committed": return `v${String(d.sessionVersion)} ${String(d.status)} state ${String(d.stateBytes)}B${d.complete ? " complete" : ""}`;
    case "studio.turn.start": return typeof d.message === "string" ? d.message.slice(0, 120) : "";
    case "studio.turn.end": return `${String(d.code)}${typeof d.text === "string" ? ` · ${d.text.slice(0, 100)}` : ""}`;
    case "studio.run.status": return String(d.status);
    case "studio.session": return `v${String(d.version)} ${String(d.status)} node ${String(d.nodeId)}`;
    case "studio.process.stdout": case "studio.process.stderr": return String(d.line ?? "").slice(0, 140);
    case "studio.process.exit": return `${String(d.label)} exited ${String(d.code)}`;
    case "refresh.due": return `trigger ${String(d.trigger)}`;
    case "service.result": return `${String(d.operation)} ${String(d.event)}${d.code ? ` ${String(d.code)}` : ""}`;
    case "lockdown": return "session locked after completion";
    default: return "";
  }
}