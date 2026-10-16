// SPDX-License-Identifier: Apache-2.0
import { useEffect, useState, type DragEvent } from "react";
import { nextFire, replyMode, terminals, type PipelineRunRecord } from "@psp-cdl/studio-core";
import { KeyValue, Notice } from "../../components/Page";
import { api, type PipelineTurnInput } from "../../lib/api";
import { readAsText } from "../../lib/files";
import { errorText, formatTime } from "../../lib/format";
import { isDirty, usePipelineEditor } from "../../pipeline/store";

const TEXT_TYPES = /^text\/|json|xml|csv|yaml|markdown/;

/**
 * Starts a session on the saved row. Sessions never run unsaved edits; `save` is offered first.
 * Returns the session id, or null when the user declined or the start failed.
 */
export async function ensureSession(save: () => Promise<boolean>): Promise<string | null> {
  const store = usePipelineEditor.getState();
  if (store.run.session) return store.run.session.sessionId;
  if (isDirty(store)) {
    if (!window.confirm("Sessions run on the saved pipeline. Save your changes and start?")) return null;
    if (!(await save())) return null;
  }
  const row = usePipelineEditor.getState().row!;
  store.setRun({ busy: true, error: null });
  try {
    const session = await api.startSession(row.id);
    usePipelineEditor.getState().setRun({ session, busy: false, records: [] });
    return session.sessionId;
  } catch (e) { usePipelineEditor.getState().setRun({ busy: false, error: errorText(e) }); return null; }
}
export async function endSession(): Promise<void> {
  const store = usePipelineEditor.getState();
  const session = store.run.session;
  if (!session) return;
  try { await api.endSession(store.row!.id, session.sessionId); } catch { /* already gone */ }
  usePipelineEditor.getState().setRun({ session: null });
}

/** The Initiator rendered outside the canvas, shaped by its trigger, with the last run record beside it. */
export function Dock({ save }: { save: () => Promise<boolean> }) {
  const config = usePipelineEditor(s => s.config)!;
  const run = usePipelineEditor(s => s.run);
  const row = usePipelineEditor(s => s.row)!;
  const { initiator } = terminals(config);
  const trigger = String(initiator?.trigger ?? "chat");
  const send = async (input: PipelineTurnInput) => {
    const sessionId = await ensureSession(save);
    if (!sessionId) return;
    const store = usePipelineEditor.getState();
    store.setRun({ busy: true, error: null });
    try {
      const record = await api.turn(row.id, sessionId, input);
      const records = [...usePipelineEditor.getState().run.records, record];
      usePipelineEditor.getState().setRun({ records, busy: false, session: { ...usePipelineEditor.getState().run.session!, context: record.context } });
      for (const c of config.components.filter(x => x.kind === "mcpproxy")) api.drift(row.id, c.id).then(r => usePipelineEditor.getState().setDrift(r)).catch(() => {});
    } catch (e) {
      usePipelineEditor.getState().setRun({ busy: false, error: errorText(e) });
      if ((e as { code?: string }).code === "NOT_FOUND") usePipelineEditor.getState().setRun({ session: null });
    }
  };
  if (!initiator) return <section className="pl-dock" aria-label="Initiator"><p className="muted">Add an Initiator to run turns.</p></section>;
  return (
    <section className="pl-dock" aria-label="Initiator">
      <div className="pl-dock-left">
        <div className="pl-dock-head">
          <strong>Initiator</strong><span className="pl-chip">{trigger}</span><span className="pl-chip">{replyMode(initiator) === "none" ? "reply: none" : "reply: channel"}</span>
          <span className="spacer" />
          <span className="muted small" role="status">{run.session ? `session ${run.session.sessionId.slice(0, 8)}… · turn ${run.records.at(-1)?.turn ?? 0} · version ${run.session.version}` : "no session"}</span>
          {run.session && <button type="button" onClick={() => void endSession()}>End session</button>}
        </div>
        {run.error && <Notice kind="error">{run.error}</Notice>}
        {run.session?.warnings.map(w => <Notice key={w} kind="warn">{w}</Notice>)}
        {trigger === "file" ? <FileComposer busy={run.busy} send={send} /> : trigger === "email" ? <EmailComposer busy={run.busy} send={send} records={run.records} />
          : trigger === "webhook" ? <WebhookComposer busy={run.busy} send={send} route={String(initiator.route ?? "/")} />
          : trigger === "schedule" ? <ScheduleComposer busy={run.busy} send={send} cron={String(initiator.cron ?? "")} prompt={String(initiator.prompt ?? "")} />
          : <ChatComposer busy={run.busy} send={send} />}
      </div>
      <RunResult record={run.records.at(-1) ?? null} />
    </section>
  );
}

type Send = (input: PipelineTurnInput) => Promise<void>;
function ChatComposer({ busy, send }: { busy: boolean; send: Send }) {
  const [text, setText] = useState("");
  return (
    <div className="stack">
      <label className="field-label" htmlFor="pl-message">Message to send through the pipeline</label>
      <textarea id="pl-message" rows={3} value={text} onChange={e => setText(e.target.value)} onKeyDown={e => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && text.trim()) void send({ text }).then(() => setText("")); }} />
      <div className="row"><button type="button" className="primary" disabled={busy || !text.trim()} onClick={() => void send({ text }).then(() => setText(""))}>{busy ? "Running…" : "Send through ring"}</button></div>
    </div>
  );
}

/** The watch folder's queue, and a drop zone that simulates a file landing. */
function FileComposer({ busy, send }: { busy: boolean; send: Send }) {
  const row = usePipelineEditor(s => s.row)!;
  const [queue, setQueue] = useState<{ watch: string | null; files: { path: string; bytes: number; modifiedAt: string }[] } | null>(null);
  const [over, setOver] = useState(false);
  const refresh = () => api.pipelineQueue(row.id).then(setQueue).catch(() => setQueue({ watch: null, files: [] }));
  useEffect(() => { void refresh(); }, [row.id, row.version]); // eslint-disable-line react-hooks/exhaustive-deps
  const land = async (file: File) => {
    const text = TEXT_TYPES.test(file.type) || /\.(txt|md|json|csv)$/i.test(file.name) ? await readAsText(file) : undefined;
    await send({ file: { name: file.name, mediaType: file.type || "application/octet-stream", bytes: file.size, ...(text !== undefined ? { text } : {}) } });
  };
  const runQueued = async (path: string) => {
    const file = await api.readFile(path);
    await send({ file: { name: path.split("/").pop()!, mediaType: "text/plain", bytes: file.bytes, text: file.text, path } });
    void refresh();
  };
  return (
    <div className="stack">
      <div className="muted small">Watching <code>{queue?.watch ?? "(set watch on the Initiator)"}</code> · {queue?.files.length ?? 0} queued. The studio has no folder watcher; run a queued file or drop one here to simulate it landing.</div>
      {queue?.files.length ? <ul className="pl-queue">{queue.files.map(f => <li key={f.path}><code>{f.path}</code><span className="muted small">{formatTime(f.modifiedAt)}</span><button type="button" disabled={busy} onClick={() => void runQueued(f.path)}>Run</button></li>)}</ul> : null}
      <div className={`dropzone${over ? " over" : ""}`} aria-label="Drop a file to simulate it landing" onDragOver={(e: DragEvent) => { if (e.dataTransfer.types.includes("Files")) { e.preventDefault(); setOver(true); } }} onDragLeave={() => setOver(false)}
        onDrop={(e: DragEvent) => { e.preventDefault(); setOver(false); const f = e.dataTransfer.files[0]; if (f) void land(f); }}>
        <span>Drop a file here</span>
        <label className="button-like">Choose a file<input type="file" aria-label="File to land" disabled={busy} onChange={e => { const f = e.target.files?.[0]; if (f) void land(f); e.target.value = ""; }} /></label>
      </div>
    </div>
  );
}

function EmailComposer({ busy, send, records }: { busy: boolean; send: Send; records: PipelineRunRecord[] }) {
  const [from, setFrom] = useState(""), [subject, setSubject] = useState(""), [body, setBody] = useState("");
  return (
    <div className="stack">
      {records.length > 0 && <div className="muted small">Recent: {records.slice(-5).map(r => r.input.summary).join(" · ")}</div>}
      <p className="muted small">The studio does not read a mailbox; paste an email to run a turn as if it arrived.</p>
      <div className="row">
        <input type="text" aria-label="From" placeholder="From" value={from} onChange={e => setFrom(e.target.value)} />
        <input type="text" aria-label="Subject" placeholder="Subject" value={subject} onChange={e => setSubject(e.target.value)} />
      </div>
      <textarea aria-label="Email body" rows={3} placeholder="Paste the email body" value={body} onChange={e => setBody(e.target.value)} />
      <div className="row"><button type="button" className="primary" disabled={busy || !body.trim()} onClick={() => void send({ email: { ...(from ? { from } : {}), ...(subject ? { subject } : {}), body } })}>{busy ? "Running…" : "Run with this email"}</button></div>
    </div>
  );
}

function WebhookComposer({ busy, send, route }: { busy: boolean; send: Send; route: string }) {
  const [method, setMethod] = useState("POST"), [body, setBody] = useState("{}");
  return (
    <div className="stack">
      <p className="muted small">The studio has no inbound listener for <code>{route}</code>; compose the request here.</p>
      <div className="row"><select aria-label="Method" value={method} onChange={e => setMethod(e.target.value)}>{["POST", "PUT", "GET"].map(m => <option key={m}>{m}</option>)}</select><code>{route}</code></div>
      <textarea aria-label="Request body" className="code" rows={3} value={body} onChange={e => setBody(e.target.value)} />
      <div className="row"><button type="button" className="primary" disabled={busy} onClick={() => void send({ webhook: { method, body } })}>{busy ? "Running…" : "Send request"}</button></div>
    </div>
  );
}

function ScheduleComposer({ busy, send, cron, prompt }: { busy: boolean; send: Send; cron: string; prompt: string }) {
  const next = cron ? nextFire(cron, new Date()) : null;
  return (
    <div className="stack">
      <KeyValue items={[["Cron", cron], ["Next fire (UTC)", next ? next.toISOString().replace(".000Z", "Z") : cron ? "invalid expression" : ""], ["Prompt", prompt]]} />
      <p className="muted small">The studio does not schedule runs; Run now sends the prompt once.</p>
      <div className="row"><button type="button" className="primary" disabled={busy || !prompt} onClick={() => void send({})}>{busy ? "Running…" : "Run now"}</button></div>
    </div>
  );
}

/** The final text as delivered (or why not), the node-by-node trace, verdicts, pruning, tool loop and drift. */
export function RunResult({ record }: { record: PipelineRunRecord | null }) {
  if (!record) return <div className="pl-dock-right" aria-label="Response"><h4>Response</h4><p className="muted small">Run the pipeline to see the reply, which registrations were pruned by covenant, the response-filter verdicts, and MCPProxy drift status.</p></div>;
  const deliveredLabel = record.delivery === "none" ? "recorded, not delivered" : record.delivery === "delivered" ? `delivered · ${record.deliveredTo ?? ""}` : `withheld${record.deliveredTo ? ` · ${record.deliveredTo}` : ""}`;
  const outcome = record.delivery === "none" ? record.toolLoop.calls.find(c => c.outcome === "OK") : undefined;
  return (
    <div className="pl-dock-right" aria-label="Response">
      <h4>Response · turn {record.turn} <span className={`badge ${record.delivery === "delivered" ? "success" : record.delivery === "none" ? "info" : "warn"}`}>{deliveredLabel}</span></h4>
      {record.error && <Notice kind={record.error.code === "COMPLETION_DENIED" || record.error.code === "OUTPUT_DENIED" ? "warn" : "error"}>{record.error.code}{record.error.message ? `: ${record.error.message}` : ""}</Notice>}
      {(record.reply || record.delivery !== "withheld") && <pre className="pl-reply" aria-label="Reply">{record.reply || "(empty)"}</pre>}
      {outcome && <p className="small">Outcome produced by <code>{outcome.tool}</code> via {outcome.proxyId}.</p>}
      <details open><summary>Response filters</summary>
        <ul className="pl-verdicts">{record.responseFilters.map(f => <li key={f.order}><span className={`pl-chip verdict-${f.verdict}`}>{f.verdict}</span> {f.kind}{f.score !== undefined ? ` · ${f.score.toFixed(2)}` : ""}{f.evidence ? <span className="muted small"> · {f.evidence}</span> : null}</li>)}</ul>
      </details>
      <details><summary>Registrations</summary>
        <KeyValue items={[["Allowed", record.registrations.allowed.join(", ")], ["Withheld by node", record.registrations.withheldByNode.join(", ")],
          ["Pruned by covenant", record.registrations.withheldByCovenant.map(w => `${w.tool} (${w.covenant})`).join(", ")], ["Not read-only", record.registrations.withheldByMode.join(", ")]]} />
      </details>
      <details><summary>Tool loop · {record.toolLoop.turns} call{record.toolLoop.turns === 1 ? "" : "s"}</summary>
        <ul className="pl-verdicts">{record.toolLoop.calls.map((c, i) => <li key={i}><code>{c.tool}</code> → {c.outcome} <span className={`pl-chip drift-${c.drift === "refused" ? "refusing" : "ok"}`}>drift {c.drift}</span></li>)}</ul>
      </details>
      <details><summary>Trace</summary>
        <ol className="pl-trace">{record.trace.map((t, i) => <li key={i}><span className="pl-chip">{t.where}</span> {t.detail}</li>)}</ol>
      </details>
      {record.taps.length > 0 && <details><summary>Taps</summary><ul className="pl-verdicts">{record.taps.map(t => <li key={t.id}>{t.id}: {t.status}{t.detail ? ` · ${t.detail}` : ""}</li>)}</ul></details>}
    </div>
  );
}
