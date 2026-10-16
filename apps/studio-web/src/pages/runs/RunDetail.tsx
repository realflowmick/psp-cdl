// SPDX-License-Identifier: Apache-2.0
import { useEffect, useMemo, useState } from "react";
import { isTerminal, type RunRecord, type StudioEvent } from "@psp-cdl/studio-core";
import { DataGrid, type Column } from "../../components/DataGrid";
import { JsonBlock, KeyValue, Loading, Notice, NotFound, PageHeader, RouteTabs, Section, SeverityBadge, StatusBadge } from "../../components/Page";
import { useStudio } from "../../data";
import { api } from "../../lib/api";
import { formatDuration, formatTime, oneLine, runDurationMs, truncate } from "../../lib/format";
import { useRunStream } from "../../lib/runEvents";
import { useSessionState } from "../../lib/session";
import { deriveTurns, digestRun, eventSummary, latestOfType, type RunTurn } from "../../lib/stream";
import { href, Link, navigate } from "../../router";
import { rerunHref } from "./RunsList";

/** Resolves a run record from the shared list, the live stream, or a direct fetch. */
export function useRun(runId: string): { record: RunRecord | null; missing: boolean; events: StudioEvent[]; replayed: boolean } {
  const { runs, runsLoaded, upsertRun } = useStudio();
  const stream = useRunStream(runId);
  const [missing, setMissing] = useState(false);
  const record = runs.find(r => r.runId === runId) ?? stream.record;
  useEffect(() => {
    if (record || !runsLoaded) return;
    let cancelled = false;
    api.run(runId).then(r => { if (!cancelled) upsertRun(r); }).catch(() => { if (!cancelled) setMissing(true); });
    return () => { cancelled = true; };
  }, [record, runsLoaded, runId, upsertRun]);
  return { record, missing, events: stream.events, replayed: stream.replayed };
}

export function runCrumbs(record: RunRecord, ...rest: { label: string; to?: string }[]) {
  return [{ label: "Runs", to: "/runs" }, { label: record.label, ...(rest.length ? { to: href("runs", record.runId) } : {}) }, ...rest];
}

export function RunDetail({ runId, tab }: { runId: string; tab: "overview" | "events" | "turns" }) {
  const { upsertRun, report } = useStudio();
  const { record, missing, events, replayed } = useRun(runId);
  const turns = useMemo(() => deriveTurns(events), [events]);
  if (!record) return missing ? <NotFound what="Run" back={{ label: "runs", to: "/runs" }} /> : <Loading />;
  const active = !isTerminal(record.status);
  return (
    <div className="page detail">
      <PageHeader crumbs={runCrumbs(record)} title={record.label} badge={<StatusBadge status={record.status} />}
        subtitle={<>{record.engine} · {record.collectionId ? `${record.collectionId} / ` : ""}{record.scenarioId} · {record.runId}{record.inspect ? " · inspect" : ""}</>}
        actions={<>
          {active && <button type="button" onClick={() => api.cancel(record.runId).then(upsertRun).catch(report)}>Cancel run</button>}
          {record.collectionId && <button type="button" onClick={() => navigate(href("collections", record.collectionId!, "scenarios", record.scenarioId))}>Edit scenario</button>}
          <button type="button" className="primary" onClick={() => navigate(rerunHref(record))}>Run again</button>
        </>} />
      <RouteTabs label="Run views" active={tab} tabs={[
        { id: "overview", label: "Overview", to: href("runs", runId) },
        { id: "events", label: `Events (${events.length})`, to: href("runs", runId, "events") },
        { id: "turns", label: `Turns (${turns.length})`, to: href("runs", runId, "turns") }
      ]} />
      {tab === "overview" && <RunOverview record={record} events={events} />}
      {tab === "events" && <RunEventsGrid gridId={`run:${runId}:events`} runId={runId} events={events} loading={!replayed} follow={active} />}
      {tab === "turns" && <TurnsGrid runId={runId} turns={turns} loading={!replayed} />}
    </div>
  );
}

function RunOverview({ record, events }: { record: RunRecord; events: StudioEvent[] }) {
  const digest = digestRun(events);
  const session = latestOfType(events, "studio.session");
  return (
    <>
      {record.error && <Notice kind="error">{record.error.code}{record.error.message ? `: ${record.error.message}` : ""}</Notice>}
      <div className="columns">
        <Section title="Run">
          <KeyValue items={[
            ["Status", <StatusBadge status={record.status} />],
            ["Engine", record.engine],
            ["Scenario", record.collectionId ? <Link to={href("collections", record.collectionId, "scenarios", record.scenarioId)}>{record.collectionId} / {record.scenarioId}</Link> : record.scenarioId],
            ["Started", formatTime(record.startedAt)],
            ["Finished", formatTime(record.finishedAt)],
            ["Duration", formatDuration(runDurationMs(record))],
            ["Inspect payloads", record.inspect ? "attached" : "digest level only"],
            ["Artifacts", <code>{record.artifactDir}</code>]
          ]} />
        </Section>
        <Section title="Activity">
          <KeyValue items={[
            ["Events", String(events.length)],
            ["Turns", String(digest.turns)],
            ["Tool dispatches released", String(digest.dispatches)],
            ["Policy denials", String(digest.denials)],
            ["Failures", String(digest.failures)],
            ["Lockdown", digest.lockdown ? <span className="badge error">locked</span> : "no"]
          ]} />
        </Section>
        {session && (
          <Section title="Session">
            <KeyValue items={[
              ["Version", String(session.data.version)], ["Status", String(session.data.status)],
              ["Node", `${String(session.data.nodeId)} ${String(session.data.nodeVersion ?? "")}`], ["State size", `${String(session.data.stateBytes)} bytes`]
            ]} />
          </Section>
        )}
      </div>
      {record.summary && <Section title="Summary"><JsonBlock value={record.summary} /></Section>}
    </>
  );
}

export function RunEventsGrid({ gridId, runId, events, loading, follow }: { gridId: string; runId: string; events: StudioEvent[]; loading: boolean; follow?: boolean }) {
  const [source, setSource] = useSessionState(`${gridId}:source`, "all");
  const [severity, setSeverity] = useSessionState(`${gridId}:severity`, "all");
  const t0 = events.length ? Date.parse(events[0]!.at) : 0;
  const sources = [...new Set(events.map(e => e.source))].sort();
  const rows = events.filter(e => (source === "all" || e.source === source) && (severity === "all" || e.severity === severity));
  const columns: Column<StudioEvent>[] = [
    { key: "seq", header: "#", width: "64px", align: "right", value: e => e.seq },
    { key: "time", header: "Time", width: "90px", align: "right", value: e => Date.parse(e.at) - t0, render: e => `+${formatDuration(Date.parse(e.at) - t0) || "0 ms"}` },
    { key: "turn", header: "Turn", width: "60px", align: "right", value: e => e.turn },
    { key: "step", header: "Step", width: "64px", align: "right", value: e => e.step ?? e.round, render: e => e.step !== undefined ? `s${e.step}` : e.round !== undefined ? `r${e.round}` : "" },
    { key: "source", header: "Source", width: "100px", value: e => e.source },
    { key: "severity", header: "Severity", width: "90px", value: e => e.severity, render: e => <SeverityBadge severity={e.severity} /> },
    { key: "type", header: "Type", width: "200px", value: e => e.type },
    { key: "detail", header: "Detail", value: e => eventSummary(e), sortable: false }
  ];
  return (
    <DataGrid id={gridId} label="Events" fill rows={rows} columns={columns} rowKey={e => String(e.seq)} loading={loading} follow={follow}
      initialSort={{ key: "seq", dir: "asc" }} pageSize={200} rowClassName={e => `sev-${e.severity}`}
      onOpen={e => navigate(href("runs", runId, "events", e.seq))}
      emptyMessage="No events yet."
      filters={<>
        <select aria-label="Source filter" value={source} onChange={e => setSource(e.target.value)}><option value="all">All sources</option>{sources.map(s => <option key={s} value={s}>{s}</option>)}</select>
        <select aria-label="Severity filter" value={severity} onChange={e => setSeverity(e.target.value)}><option value="all">All severities</option>{["info", "success", "warn", "error"].map(s => <option key={s} value={s}>{s}</option>)}</select>
      </>} />
  );
}

function TurnsGrid({ runId, turns, loading }: { runId: string; turns: RunTurn[]; loading: boolean }) {
  const columns: Column<RunTurn>[] = [
    { key: "turn", header: "Turn", width: "64px", align: "right", value: t => t.turn },
    { key: "outcome", header: "Outcome", width: "220px", value: t => t.code ?? "running", render: t => <StatusBadge status={t.code ?? "running"} /> },
    { key: "message", header: "Message", value: t => t.message ? truncate(oneLine(t.message), 120) : "" },
    { key: "response", header: "Response", value: t => t.text ? truncate(oneLine(t.text), 120) : "" },
    { key: "session", header: "Session", width: "120px", value: t => t.sessionVersion, render: t => t.sessionVersion === null ? "" : `v${t.sessionVersion} ${t.sessionStatus ?? ""}` },
    { key: "events", header: "Events", width: "80px", align: "right", value: t => t.events }
  ];
  return (
    <DataGrid id={`run:${runId}:turns`} label="Turns" fill rows={turns} columns={columns} rowKey={t => String(t.turn)} loading={loading}
      initialSort={{ key: "turn", dir: "asc" }} onOpen={t => navigate(href("runs", runId, "turns", t.turn))}
      emptyMessage="This run reports no turns. Engines other than the live loop stream records on the Events tab." />
  );
}