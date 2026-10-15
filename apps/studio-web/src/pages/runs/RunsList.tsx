// SPDX-License-Identifier: Apache-2.0
import { isTerminal, type RunRecord } from "@psp-cdl/studio-core";
import { DataGrid, type Column } from "../../components/DataGrid";
import { ListPage, StatusBadge } from "../../components/Page";
import { useStudio } from "../../data";
import { api } from "../../lib/api";
import { formatDuration, formatTime, runDurationMs } from "../../lib/format";
import { useSessionState } from "../../lib/session";
import { href, navigate } from "../../router";

export const rerunHref = (r: Pick<RunRecord, "collectionId" | "scenarioId">): string =>
  `/runs/new?${new URLSearchParams({ ...(r.collectionId ? { collection: r.collectionId } : {}), scenario: r.scenarioId }).toString()}`;

const columns: Column<RunRecord>[] = [
  { key: "status", header: "Status", width: "120px", value: r => r.status, render: r => <StatusBadge status={r.status} /> },
  { key: "label", header: "Label", value: r => r.label },
  { key: "engine", header: "Engine", width: "100px", value: r => r.engine },
  { key: "scenario", header: "Scenario", value: r => r.collectionId ? `${r.collectionId} / ${r.scenarioId}` : r.scenarioId },
  { key: "started", header: "Started", width: "170px", value: r => r.startedAt, render: r => formatTime(r.startedAt) },
  { key: "duration", header: "Duration", width: "100px", align: "right", value: r => runDurationMs(r), render: r => formatDuration(runDurationMs(r)) },
  { key: "events", header: "Events", width: "80px", align: "right", value: r => r.lastSeq },
  { key: "error", header: "Error", width: "200px", value: r => r.error?.code ?? "" },
  { key: "inspect", header: "Inspect", width: "80px", value: r => r.inspect }
];

export function RunsList() {
  const { runs, runsLoaded, refreshRuns, upsertRun, report } = useStudio();
  const [status, setStatus] = useSessionState("runs:status", "all");
  const [engine, setEngine] = useSessionState("runs:engine", "all");
  const engines = [...new Set(runs.map(r => r.engine))].sort();
  const rows = runs.filter(r => (status === "all" || (status === "active" ? !isTerminal(r.status) : r.status === status)) && (engine === "all" || r.engine === engine));
  return (
    <ListPage title="Runs" subtitle="Every run of a scenario, newest first. Double-click a run to follow its events.">
      <DataGrid id="runs" label="Runs" fill rows={rows} columns={columns} rowKey={r => r.runId} loading={!runsLoaded}
        initialSort={{ key: "started", dir: "desc" }} onOpen={r => navigate(href("runs", r.runId))}
        emptyMessage="No runs yet. Use New run to start one."
        filters={<>
          <select aria-label="Status filter" value={status} onChange={e => setStatus(e.target.value)}>
            {["all", "active", "completed", "failed", "cancelled"].map(v => <option key={v} value={v}>{v === "all" ? "All statuses" : v}</option>)}
          </select>
          <select aria-label="Engine filter" value={engine} onChange={e => setEngine(e.target.value)}>
            <option value="all">All engines</option>{engines.map(v => <option key={v} value={v}>{v}</option>)}
          </select>
        </>}
        actions={selected => <>
          <button type="button" className="primary" onClick={() => navigate("/runs/new")}>New run</button>
          <button type="button" disabled={!selected} onClick={() => selected && navigate(rerunHref(selected))}>Run again</button>
          <button type="button" disabled={!selected || isTerminal(selected.status)} onClick={() => selected && api.cancel(selected.runId).then(upsertRun).catch(report)}>Cancel run</button>
          <button type="button" onClick={() => void refreshRuns()}>Refresh</button>
        </>} />
    </ListPage>
  );
}