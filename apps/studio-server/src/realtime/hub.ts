// SPDX-License-Identifier: Apache-2.0
import type { Server as HttpServer } from "node:http";
import { Server, type Socket } from "socket.io";
import { isIdentifier, type RunRecord, type StudioEvent } from "@psp-cdl/studio-core";
import type { RunManager } from "../runs/manager.js";

export const SOCKET_PATH = "/studio/socket";
const REPLAY_CHUNK = 500;
const MAX_SUBSCRIPTIONS = 32;

/**
 * Pushes run records and journal events to browsers. A client subscribes to a run with the
 * last sequence it holds; the hub replays the journal from there and then streams live events.
 * Replay reads the file, so a reconnecting client never misses or duplicates an event.
 */
export class RealtimeHub {
  readonly io: Server;
  private readonly stop: (() => void)[] = [];
  constructor(http: HttpServer, private readonly runs: RunManager, corsOrigins: readonly string[]) {
    this.io = new Server(http, {
      path: SOCKET_PATH, serveClient: false, maxHttpBufferSize: 64 * 1024, pingInterval: 10_000, pingTimeout: 20_000,
      ...(corsOrigins.length ? { cors: { origin: [...corsOrigins], methods: ["GET", "POST"] } } : {})
    });
    this.stop.push(runs.onEvent(event => this.io.to(room(event.runId)).emit("event", event)));
    this.stop.push(runs.onStatus(record => this.io.emit("run", record)));
    this.io.on("connection", socket => this.attach(socket));
  }
  private attach(socket: Socket): void {
    const subscriptions = new Set<string>();
    socket.on("subscribe", (payload: unknown, ack?: (reply: unknown) => void) => {
      const { runId, fromSeq } = (payload ?? {}) as { runId?: unknown; fromSeq?: unknown };
      const reply = (value: unknown) => { if (typeof ack === "function") ack(value); };
      if (!isIdentifier(runId) && !(typeof runId === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(runId))) return reply({ error: { code: "INVALID_RUN" } });
      if (subscriptions.size >= MAX_SUBSCRIPTIONS && !subscriptions.has(runId as string)) return reply({ error: { code: "TOO_MANY_SUBSCRIPTIONS" } });
      let record: RunRecord;
      try { record = this.runs.get(runId as string); } catch { return reply({ error: { code: "NOT_FOUND" } }); }
      const start = Number.isSafeInteger(fromSeq) && (fromSeq as number) >= 1 ? fromSeq as number : 1;
      // Join first so nothing emitted during replay is lost; the client de-duplicates by seq.
      subscriptions.add(record.runId);
      void socket.join(room(record.runId));
      const events = this.runs.events(record.runId, start);
      for (let i = 0; i < events.length; i += REPLAY_CHUNK) socket.emit("replay", { runId: record.runId, events: events.slice(i, i + REPLAY_CHUNK), done: i + REPLAY_CHUNK >= events.length });
      if (!events.length) socket.emit("replay", { runId: record.runId, events: [] as StudioEvent[], done: true });
      reply({ run: record, replayed: events.length });
    });
    socket.on("unsubscribe", (payload: unknown) => {
      const runId = (payload as { runId?: unknown } | null)?.runId;
      if (typeof runId !== "string") return;
      subscriptions.delete(runId);
      void socket.leave(room(runId));
    });
  }
  async close(): Promise<void> {
    for (const stop of this.stop) stop();
    await new Promise<void>(resolve => this.io.close(() => resolve()));
  }
}
const room = (runId: string): string => `run:${runId}`;
