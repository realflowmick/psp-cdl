// SPDX-License-Identifier: Apache-2.0
import { useCallback, useEffect, useMemo, useState } from "react";
import { documentToObject, parseMarkup } from "@psp-cdl/core";
import { format as formatDelta } from "jsondiffpatch/formatters/html";
import "jsondiffpatch/formatters/styles/html.css";
import type { Delta } from "jsondiffpatch";
import { DataGrid, type Column } from "../../components/DataGrid";
import { Checkbox } from "../../components/fields";
import { KeyValue, ListPage, Loading, Notice, NotFound, PageHeader, Section, StatusBadge, Tabs } from "../../components/Page";
import { useStudio } from "../../data";
import { api, ApiError, type AssistantSummaryView, type AssistantView } from "../../lib/api";
import { errorText, formatBytes, formatDuration, formatTime, oneLine, truncate } from "../../lib/format";
import { useSessionState } from "../../lib/session";
import { href, Link, navigate, useLocation, useQueryParam } from "../../router";
import { lineDiff, summarizeChanges, type NodeChange, type TransitionChange } from "../../psp/diff";
import { pspHref } from "../scenarios/ScenarioForms";
import { AssistantDialog } from "./AssistantDialog";

const engineLabel = (r: { provider: string; model: string }) => `${r.provider === "anthropic" ? "Anthropic" : "OpenAI"} · ${r.model}`;
const tokens = (r: { usage: { inputTokens: number; outputTokens: number } | null }) => r.usage ? r.usage.inputTokens + r.usage.outputTokens : null;

/** Every prompt sent to the assistant and what became of it, newest first. */
export function AssistantHistory() {
  const { report } = useStudio();
  const file = useLocation().search.get("file");
  const [rows, setRows] = useState<AssistantSummaryView[] | null>(null);
  const [status, setStatus] = useSessionState("assistant:status", "all");
  const [dialog, setDialog] = useState(false);
  const refresh = useCallback(() => api.assistantRequests(file ?? undefined).then(setRows).catch(report), [file, report]);
  useEffect(() => { void refresh(); }, [refresh]);
  const running = rows?.some(r => r.status === "running") ?? false;
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => void refresh(), 2000);
    return () => clearInterval(timer);
  }, [running, refresh]);
  const columns: Column<AssistantSummaryView>[] = [
    { key: "created", header: "Requested", width: "170px", value: r => r.createdAt, render: r => formatTime(r.createdAt) },
    { key: "status", header: "Status", width: "110px", value: r => r.status, render: r => <StatusBadge status={r.status} /> },
    { key: "path", header: "File", width: "200px", value: r => r.path, render: r => <code>{r.path}</code> },
    { key: "mode", header: "Change", width: "90px", value: r => r.baseId ? "refine" : r.mode },
    { key: "prompt", header: "Prompt", value: r => oneLine(r.prompt) },
    { key: "engine", header: "Engine", width: "200px", value: r => engineLabel(r) },
    { key: "files", header: "Attached", width: "80px", align: "right", value: r => r.attachments.length || "" },
    { key: "tokens", header: "Tokens", width: "90px", align: "right", value: r => tokens(r) ?? "" }
  ];
  const shown = (rows ?? []).filter(r => status === "all" || r.status === status);
  return (
    <ListPage title="Assistant history" subtitle={<>Every prompt and the change it produced, kept under the workspace's <code>.studio/assistant/</code>, apart from the applications. Double-click a request to review it.{file && <> Showing <code>{file}</code>. <Link to="/psp/assistant">Show all files</Link></>}</>}>
      <DataGrid id="assistant" label="Assistant requests" fill rows={shown} columns={columns} rowKey={r => r.id} loading={!rows}
        initialSort={{ key: "created", dir: "desc" }} onOpen={r => navigate(href("psp", "assistant", r.id))} emptyMessage="No prompts yet. Use New request to ask the assistant for an application."
        filters={<select aria-label="Status filter" value={status} onChange={e => setStatus(e.target.value)}>
          {["all", "running", "proposed", "accepted", "rejected", "failed", "cancelled"].map(v => <option key={v} value={v}>{v === "all" ? "All statuses" : v}</option>)}
        </select>}
        actions={selected => <>
          <button type="button" className="primary" onClick={() => setDialog(true)}>New request</button>
          <button type="button" disabled={!selected} onClick={() => selected && navigate(pspHref(selected.path))}>Open file</button>
          <button type="button" onClick={() => void refresh()}>Refresh</button>
        </>} />
      {dialog && <AssistantDialog path={file} onClose={() => setDialog(false)} />}
    </ListPage>
  );
}

/** One request: what was asked, and the proposed change to review before accepting it. */
export function AssistantRecordPage({ id }: { id: string }) {
  const { refreshFiles, files } = useStudio();
  const [record, setRecord] = useState<AssistantView | null>(null);
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [refine, setRefine] = useState(false);
  const [tab, setTab] = useQueryParam("tab", "changes");
  const load = useCallback(() => api.assistantRequest(id).then(setRecord).catch(e => { if (e instanceof ApiError && e.status === 404) setMissing(true); else setError(errorText(e)); }), [id]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (record?.status !== "running") return;
    const timer = setTimeout(() => void load(), 1500);
    return () => clearTimeout(timer);
  }, [record, load]);
  if (missing) return <NotFound what="Assistant request" back={{ label: "assistant history", to: "/psp/assistant" }} />;
  if (!record) return <Loading />;

  const act = async (work: () => Promise<AssistantView>) => {
    setBusy(true); setError(null);
    try { setRecord(await work()); setConflict(null); } catch (e) {
      if (e instanceof ApiError && e.code === "FILE_CHANGED") setConflict(e.message); else setError(errorText(e));
    } finally { setBusy(false); }
  };
  const accept = (force: boolean) => act(async () => { const next = await api.acceptAssistant(id, force); void refreshFiles(); return next; });
  const exists = files.some(f => f.path === record.path);
  return (
    <div className="page detail">
      <PageHeader crumbs={[{ label: "PSP applications", to: "/psp" }, { label: "Assistant history", to: "/psp/assistant" }, { label: record.id }]}
        title={record.baseId ? "Refinement" : record.mode === "create" ? "New application" : "Change request"} badge={<StatusBadge status={record.status} />}
        subtitle={<><code>{record.path}</code> · {engineLabel(record)} · {formatTime(record.createdAt)}</>}
        actions={<>
          {record.status === "running" && <button type="button" disabled={busy} onClick={() => void act(() => api.cancelAssistant(id))}>Cancel</button>}
          {record.proposal !== null && <button type="button" disabled={busy} onClick={() => setRefine(true)}>Refine</button>}
          {record.status === "proposed" && <button type="button" className="danger" disabled={busy} onClick={() => void act(() => api.rejectAssistant(id))}>Reject</button>}
          {record.status === "proposed" && <button type="button" className="primary" disabled={busy} onClick={() => void accept(false)}>Accept</button>}
          {exists && <button type="button" onClick={() => navigate(pspHref(record.path))}>Open in PSP editor</button>}
        </>} />
      {error && <Notice kind="error">{error}</Notice>}
      {conflict && (
        <Notice kind="warn">{conflict} <button type="button" disabled={busy} onClick={() => void accept(true)}>Accept anyway</button></Notice>
      )}
      {record.status === "accepted" && <Notice kind="info">Accepted {formatTime(record.decidedAt)} and written to <Link to={pspHref(record.path)}>{record.path}</Link>.</Notice>}
      {record.status === "running" && <Notice kind="info"><span role="status">The model is writing{record.progress ? `: ${record.progress.toLocaleString()} characters so far` : ""}…</span></Notice>}
      {record.error && <Notice kind="error">{record.error.code}: {record.error.message}</Notice>}
      <Section title="Request">
        <KeyValue items={[
          ["File", <code>{record.path}</code>],
          ["Change", record.mode === "create" ? "Create a new application" : "Change the existing application"],
          ["Refines", record.baseId ? <Link to={href("psp", "assistant", record.baseId)}>{record.baseId}</Link> : null],
          ["Engine", engineLabel(record)],
          ["Duration", record.durationMs === null ? null : formatDuration(record.durationMs)],
          ["Tokens", record.usage ? `${record.usage.inputTokens.toLocaleString()} in · ${record.usage.outputTokens.toLocaleString()} out` : null],
          ["Attempts", record.attempts > 1 ? `${record.attempts} (the first reply did not parse)` : record.attempts ? String(record.attempts) : null]
        ]} />
        <pre className="prompt-text" aria-label="Prompt">{record.prompt}</pre>
        {record.attachments.length > 0 && (
          <ul className="attachments" aria-label="Attachments">
            {record.attachments.map(a => <li key={a.sha256 + a.name}><span>{a.name}</span><span className="muted small">{a.kind} · {formatBytes(a.bytes)} · sha256 {a.sha256.slice(0, 12)}</span></li>)}
          </ul>
        )}
      </Section>
      {record.proposal !== null && <Proposal record={record} tab={tab} setTab={setTab} />}
      {refine && <AssistantDialog base={record} onClose={() => setRefine(false)} />}
    </div>
  );
}

function Proposal({ record, tab, setTab }: { record: AssistantView; tab: string; setTab(tab: string): void }) {
  const proposal = record.proposal!;
  const summary = useMemo(() => summarizeChanges(record.before, proposal), [record.before, proposal]);
  const rows = useMemo(() => lineDiff(record.before ?? "", proposal), [record.before, proposal]);
  const [unchanged, setUnchanged] = useState(false);
  const html = useMemo(() => {
    if (!record.delta) return null;
    let left: unknown = null;
    if (record.before !== null) { try { left = documentToObject(parseMarkup(record.before), false); } catch { left = { kind: "unparsed", text: record.before }; } }
    return formatDelta(record.delta as Delta, left) ?? null;
  }, [record.delta, record.before]);
  const tabs = [{ id: "changes", label: "Changes" }, { id: "source", label: "Source diff" }, { id: "json", label: "JSON diff" }, { id: "proposal", label: "Proposed source" }];
  const active = tabs.some(t => t.id === tab) ? tab : "changes";
  const counts = `${summary.nodes.added.length} added, ${summary.nodes.removed.length} removed, ${summary.nodes.changed.length} changed`;
  return (
    <Section title="Proposed change" description={record.delta === null && record.before !== null ? "The model returned the application unchanged." : undefined}>
      {record.summary && <blockquote className="model-summary" aria-label="Model summary"><span className="muted small">The model's description</span>{record.summary}</blockquote>}
      <Tabs label="Proposal views" tabs={tabs} active={active} onSelect={setTab} />
      <div role="tabpanel" aria-label={tabs.find(t => t.id === active)!.label}>
        {active === "changes" && (summary.parsed ? (
          <div className="change-lists">
            <p className="muted small">Nodes: {counts}. Transitions: {summary.transitions.added.length} added, {summary.transitions.removed.length} removed, {summary.transitions.changed.length} changed.</p>
            <NodeList title="Nodes added" items={summary.nodes.added} kind="add" />
            <NodeList title="Nodes removed" items={summary.nodes.removed} kind="del" />
            <NodeList title="Nodes changed" items={summary.nodes.changed} kind="mod" />
            <EdgeList title="Transitions added" items={summary.transitions.added} kind="add" />
            <EdgeList title="Transitions removed" items={summary.transitions.removed} kind="del" />
            <EdgeList title="Transitions changed" items={summary.transitions.changed} kind="mod" />
          </div>
        ) : <Notice kind="warn">One side does not parse as PSP, so only the source diff is meaningful.</Notice>)}
        {active === "source" && (
          <div className="diff-scroll">
            <table className="diff" aria-label="Source diff"><tbody>
              {rows.map((row, i) => row.kind === "skip"
                ? <tr key={i} className="skip"><td colSpan={4}>⋯ {row.count} unchanged line{row.count === 1 ? "" : "s"}</td></tr>
                : <tr key={i} className={row.kind}><td className="ln">{row.left ?? ""}</td><td className="ln">{row.right ?? ""}</td><td className="mark">{row.kind === "add" ? "+" : row.kind === "del" ? "−" : ""}</td><td><code>{row.text}</code></td></tr>)}
            </tbody></table>
          </div>
        )}
        {active === "json" && (html ? (
          <>
            <Checkbox label="Show unchanged parts" checked={unchanged} onChange={setUnchanged} />
            <p className="muted small">The jsondiffpatch delta recorded with this request, over the parsed PSP document tree.</p>
            {/* The formatter escapes every value it prints; the delta comes from the server record. */}
            <div className={`jsondiff-view${unchanged ? " show-unchanged" : ""}`} dangerouslySetInnerHTML={{ __html: html }} />
          </>
        ) : <p className="muted">No differences.</p>)}
        {active === "proposal" && <pre className="json source-view" aria-label="Proposed source">{proposal}</pre>}
      </div>
    </Section>
  );
}
const where = (scope: string[]) => scope.length ? `${scope.join(" › ")} › ` : "";
function NodeList({ title, items, kind }: { title: string; items: NodeChange[]; kind: string }) {
  if (!items.length) return null;
  return <div><h4>{title} ({items.length})</h4><ul className={`change ${kind}`}>{items.map(n => <li key={[...n.scope, n.key].join("/")}><span className="muted">{where(n.scope)}</span><code>{n.key}</code> <span className="muted small">{n.nodeType}</span></li>)}</ul></div>;
}
function EdgeList({ title, items, kind }: { title: string; items: TransitionChange[]; kind: string }) {
  if (!items.length) return null;
  return <div><h4>{title} ({items.length})</h4><ul className={`change ${kind}`}>{items.map((e, i) => <li key={i}><span className="muted">{where(e.scope)}</span><code>{e.source}</code> → <code>{e.target}</code>{e.condition && <span className="muted">: {truncate(e.condition, 100)}</span>}</li>)}</ul></div>;
}
