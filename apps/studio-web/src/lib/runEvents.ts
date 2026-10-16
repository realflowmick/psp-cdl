// SPDX-License-Identifier: Apache-2.0
import { useSyncExternalStore } from "react";
import type { RunRecord, StudioEvent } from "@psp-cdl/studio-core";
import { studioSocket } from "./socket";
import { lastSeq, mergeEvents, subscribeRun } from "./stream";

/**
 * One live subscription per run, shared by the run's overview, events, turns and event-detail routes,
 * so moving between them never re-downloads the journal. A reconnect resubscribes from the last seq.
 */
export interface RunStream { events: StudioEvent[]; record: RunRecord | null; replayed: boolean }
interface Entry { snapshot: RunStream; listeners: Set<() => void>; stop: () => void; touched: number }
const MAX_ENTRIES = 12;
const entries = new Map<string, Entry>();
const EMPTY: RunStream = { events: [], record: null, replayed: false };

function open(runId: string): Entry {
  const existing = entries.get(runId);
  if (existing) { existing.touched = Date.now(); return existing; }
  const socket = studioSocket();
  const entry: Entry = { snapshot: { ...EMPTY }, listeners: new Set(), stop: () => {}, touched: Date.now() };
  const publish = (patch: Partial<RunStream>) => { entry.snapshot = { ...entry.snapshot, ...patch }; for (const listener of entry.listeners) listener(); };
  const onEvents = (incoming: StudioEvent[]) => publish({ events: mergeEvents(entry.snapshot.events, incoming), replayed: true });
  const onRecord = (record: RunRecord) => publish({ record });
  let stop = subscribeRun(socket, runId, 1, onEvents, onRecord);
  const onConnect = () => { stop(); stop = subscribeRun(socket, runId, lastSeq(entry.snapshot.events) + 1, onEvents, onRecord); };
  socket.on("connect", onConnect);
  entry.stop = () => { stop(); socket.off("connect", onConnect); };
  entries.set(runId, entry);
  evict();
  return entry;
}
function evict(): void {
  if (entries.size <= MAX_ENTRIES) return;
  const idle = [...entries.entries()].filter(([, e]) => !e.listeners.size).sort((a, b) => a[1].touched - b[1].touched);
  for (const [runId, entry] of idle.slice(0, entries.size - MAX_ENTRIES)) { entry.stop(); entries.delete(runId); }
}

export function useRunStream(runId: string): RunStream {
  return useSyncExternalStore(
    listener => { const entry = open(runId); entry.listeners.add(listener); return () => { entry.listeners.delete(listener); }; },
    () => entries.get(runId)?.snapshot ?? EMPTY,
    () => EMPTY
  );
}
/** Test hook. */
export function resetRunStreams(): void { for (const entry of entries.values()) entry.stop(); entries.clear(); }