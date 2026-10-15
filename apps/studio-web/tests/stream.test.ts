// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it, vi } from "vitest";
import type { StudioEvent } from "@psp-cdl/studio-core";
import { deriveTurns, digestRun, eventSummary, filterEvents, groupTurns, lastSeq, mergeEvents, subscribeRun, type StudioSocket } from "../src/lib/stream";

const ev = (seq: number, type: string, extra: Partial<StudioEvent> = {}): StudioEvent =>
  ({ runId: "r1", seq, at: "2026-10-11T00:00:00Z", engine: "live-loop", source: "llmproxy", severity: "info", type, data: {}, ...extra });

describe("mergeEvents", () => {
  it("de-duplicates by seq and keeps journal order", () => {
    const merged = mergeEvents([ev(1, "a"), ev(3, "c")], [ev(2, "b"), ev(3, "c-dup"), ev(1, "a-dup")]);
    expect(merged.map(e => [e.seq, e.type])).toEqual([[1, "a"], [2, "b"], [3, "c"]]);
    expect(lastSeq(merged)).toBe(3);
    expect(lastSeq([])).toBe(0);
  });
});

describe("groupTurns and filterEvents", () => {
  const events = [ev(1, "studio.run.status", { source: "studio" }), ev(2, "turn.start", { turn: 1 }), ev(3, "cdl.decision", { turn: 1, data: { decision: "deny" }, severity: "error" }), ev(4, "turn.start", { turn: 2 }), ev(5, "studio.run.status", { source: "studio", severity: "success" })];
  it("groups consecutive events by turn", () => {
    expect(groupTurns(events).map(g => [g.turn, g.events.length])).toEqual([[null, 1], [1, 2], [2, 1], [null, 1]]);
  });
  it("filters by source, severity and text", () => {
    expect(filterEvents(events, { sources: new Set(["studio"]) }).map(e => e.seq)).toEqual([1, 5]);
    expect(filterEvents(events, { severities: new Set(["error"]) }).map(e => e.seq)).toEqual([3]);
    expect(filterEvents(events, { text: "DENY" }).map(e => e.seq)).toEqual([3]);
    expect(filterEvents(events, {})).toHaveLength(5);
  });
  it("digests denials, failures, dispatches and lockdown", () => {
    const digest = digestRun([...events, ev(6, "studio.turn.start", { source: "studio" }), ev(7, "turn.failed"), ev(8, "dispatch.released", { source: "mcpproxy" }), ev(9, "lockdown"), ev(10, "studio.run.status", { source: "studio", data: { status: "completed" } })]);
    expect(digest).toEqual({ turns: 1, denials: 1, failures: 1, dispatches: 1, lockdown: true, lastStatus: "completed" });
  });
});

describe("subscribeRun", () => {
  function fakeSocket(): StudioSocket & { listeners: Map<string, Set<(...args: any[]) => void>>; emitted: unknown[][]; fire(event: string, ...args: unknown[]): void } {
    const listeners = new Map<string, Set<(...args: any[]) => void>>(), emitted: unknown[][] = [];
    return {
      listeners, emitted,
      on: (event, listener) => { (listeners.get(event) ?? listeners.set(event, new Set()).get(event)!).add(listener); },
      off: (event, listener) => { listeners.get(event)?.delete(listener); },
      emit: (event, ...args) => { emitted.push([event, ...args]); },
      fire: (event, ...args) => { for (const l of listeners.get(event) ?? []) l(...args); }
    };
  }
  it("delivers replay chunks and live events for the subscribed run only, then unsubscribes", () => {
    const socket = fakeSocket(), received: StudioEvent[][] = [], records: unknown[] = [];
    const stop = subscribeRun(socket, "r1", 4, events => received.push(events), record => records.push(record));
    expect(socket.emitted[0]?.slice(0, 2)).toEqual(["subscribe", { runId: "r1", fromSeq: 4 }]);
    (socket.emitted[0]![2] as (reply: unknown) => void)({ run: { runId: "r1", status: "running" } });
    socket.fire("replay", { runId: "r1", events: [ev(4, "a"), ev(5, "b")], done: true });
    socket.fire("replay", { runId: "other", events: [ev(1, "x")], done: true });
    socket.fire("event", ev(6, "c"));
    socket.fire("event", ev(2, "y", { runId: "other" }));
    socket.fire("run", { runId: "r1", status: "completed" });
    socket.fire("run", { runId: "other", status: "failed" });
    expect(received.flat().map(e => e.seq)).toEqual([4, 5, 6]);
    expect(records.map(r => (r as { status: string }).status)).toEqual(["running", "completed"]);
    stop();
    expect(socket.emitted.at(-1)).toEqual(["unsubscribe", { runId: "r1" }]);
    socket.fire("event", ev(7, "late"));
    expect(received.flat()).toHaveLength(3);
    expect([...socket.listeners.values()].every(set => set.size === 0)).toBe(true);
    void vi;
  });
});

describe("deriveTurns and eventSummary", () => {
  it("rebuilds each turn from the journal", () => {
    const turns = deriveTurns([
      ev(1, "studio.run.status", { source: "studio" }),
      ev(2, "studio.turn.start", { turn: 1, data: { requestId: "turn-1", message: "Hello" } }),
      ev(3, "cdl.decision", { turn: 1, data: { decision: "allow" } }),
      ev(4, "studio.turn.end", { turn: 1, data: { code: "OK", text: "Hi." } }),
      ev(5, "studio.session", { turn: 1, data: { version: 2, status: "running" } }),
      ev(6, "studio.turn.start", { turn: 2, data: { message: "Again" } })
    ]);
    expect(turns).toEqual([
      { turn: 1, requestId: "turn-1", message: "Hello", code: "OK", text: "Hi.", sessionVersion: 2, sessionStatus: "running", startSeq: 2, endSeq: 4, events: 4 },
      { turn: 2, requestId: null, message: "Again", code: null, text: null, sessionVersion: null, sessionStatus: null, startSeq: 6, endSeq: null, events: 1 }
    ]);
  });
  it("summarizes common events on one line", () => {
    expect(eventSummary(ev(1, "cdl.decision", { data: { phase: "tool", decision: "deny", reasonCodes: ["CAPABILITY_DENIED"] } }))).toBe("tool → deny (CAPABILITY_DENIED)");
    expect(eventSummary(ev(1, "turn.committed", { data: { sessionVersion: 2, status: "running", stateBytes: 40, complete: false } }))).toBe("v2 running state 40B");
    expect(eventSummary(ev(1, "studio.turn.end", { data: { code: "OK", text: "Done." } }))).toBe("OK · Done.");
    expect(eventSummary(ev(1, "prompt.loaded"))).toBe("");
  });
});