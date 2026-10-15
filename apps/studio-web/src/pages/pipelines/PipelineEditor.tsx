// SPDX-License-Identifier: Apache-2.0
// The detail route. Its diagram library, forms and Monaco load on demand, when a pipeline is opened.
import { useCallback, useEffect, useState } from "react";
import { ReactFlowProvider, useReactFlow } from "@xyflow/react";
import { Group, Panel, Separator } from "react-resizable-panels";
import { formatConfig, problemCounts, type PipelineConfig, type PipelineRow } from "@psp-cdl/studio-core";
import { EditorFrame, Loading, Notice, NotFound } from "../../components/Page";
import { api, ApiError } from "../../lib/api";
import { download } from "../../lib/files";
import { errorText } from "../../lib/format";
import { updateQuery, useLocation } from "../../router";
import { isDirty, usePipelineEditor } from "../../pipeline/store";
import { PipelineCanvas } from "./Canvas";
import { Dialogs } from "./Dialogs";
import { DocumentMode } from "./DocumentMode";
import { Dock, endSession, ensureSession } from "./Dock";
import { Palette } from "./Palette";
import { RightPanel } from "./RightPanel";
import "./pipeline.css";

export default function PipelineEditor({ id }: { id: string }) {
  const [state, setState] = useState<"loading" | "missing" | "ready">("loading");
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    api.pipeline(id).then(row => { if (cancelled) return; usePipelineEditor.getState().load(row); setState("ready"); })
      .catch(e => { if (cancelled) return; if (e instanceof ApiError && e.status === 404) setState("missing"); else setError(errorText(e)); });
    return () => { cancelled = true; void endSession(); };
  }, [id]);
  if (state === "missing") return <NotFound what="Pipeline" back={{ label: "Pipelines", to: "/pipelines" }} />;
  if (error) return <div className="page"><Notice kind="error">{error}</Notice></div>;
  if (state === "loading") return <Loading />;
  return <ReactFlowProvider><LoadedEditor /></ReactFlowProvider>;
}

const isTyping = (target: EventTarget | null) => target instanceof HTMLElement && (["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) || target.isContentEditable || !!target.closest(".pl-monaco"));

/** Read-only runtime surfaces: drift (stored, no backend call) and vector store status. */
function refreshStatus(row: PipelineRow): void {
  const store = usePipelineEditor.getState();
  for (const c of row.config.components) {
    if (c.kind === "mcpproxy") api.drift(row.id, c.id).then(r => store.setDrift(r)).catch(() => {});
    if (c.kind === "vector-store") api.vectorStatus(row.id, c.id).then(v => store.setVectors(v)).catch(() => {});
  }
}

function LoadedEditor() {
  const row = usePipelineEditor(s => s.row)!;
  const config = usePipelineEditor(s => s.config)!;
  const dirty = usePipelineEditor(isDirty);
  const problems = usePipelineEditor(s => s.problems);
  const canUndo = usePipelineEditor(s => s.past.length > 0), canRedo = usePipelineEditor(s => s.future.length > 0);
  const run = usePipelineEditor(s => s.run);
  const store = usePipelineEditor.getState;
  const flow = useReactFlow();
  const location = useLocation();
  const view = location.search.get("view") === "document" ? "document" : "visual";
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [validated, setValidated] = useState<string | null>(null);

  // The server supplies the environment (pointer resolution, catalogs, keys); the shared validator runs here on every change.
  const validate = useCallback(async (value: PipelineConfig) => {
    try { const { env } = await api.validatePipeline(value, row.id); if (store().config === value || formatConfig(store().config!) === formatConfig(value)) store().setEnv(env); }
    catch { /* the local result stands until the server answers */ }
  }, [row.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { const timer = setTimeout(() => void validate(config), 300); return () => clearTimeout(timer); }, [config, validate]);
  useEffect(() => { refreshStatus(row); }, [row]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || isTyping(e.target)) return;
      const k = e.key.toLowerCase();
      if (k === "z" && !e.shiftKey) { e.preventDefault(); store().undo(); }
      else if (k === "y" || (k === "z" && e.shiftKey)) { e.preventDefault(); store().redo(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const save = useCallback(async (): Promise<boolean> => {
    const { config: current, row: base, problems: found } = store();
    if (found.some(p => p.code === "SCHEMA")) { setError("Fix the schema errors before saving; the Problems list names them."); return false; }
    setSaving(true); setError(null);
    try {
      const saved = await api.savePipeline(base!.id, current!, base!.version);
      store().markSaved(saved);
      return true;
    } catch (e) {
      if (e instanceof ApiError && e.code === "VERSION_CONFLICT") {
        if (window.confirm(`${e.message}\n\nReload the saved pipeline? Your unsaved changes here are discarded.`)) { const fresh = await api.pipeline(base!.id); store().load(fresh); }
        else setError(`${e.message} Save is refused until you reload.`);
      } else setError(errorText(e));
      return false;
    } finally { setSaving(false); }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const exportFile = async () => {
    if (dirty && !window.confirm("Export writes the saved pipeline, not your unsaved changes. Export anyway?")) return;
    try { const file = await api.exportPipeline(row.id); download(file.name, file.text, "application/json;charset=utf-8"); } catch (e) { setError(errorText(e)); }
  };
  const counts = problemCounts(problems);
  return (
    <EditorFrame className="fill pl-editor-page" crumbs={[{ label: "Pipelines", to: "/pipelines" }, { label: config.name }]} title={config.name}
      subtitle={config.description} dirty={dirty} saving={saving} error={error} onSave={() => void save()} onRevert={() => store().apply(row.config)}
      badge={counts.error ? <span className="badge error" title="Errors">{counts.error} error{counts.error === 1 ? "" : "s"}</span> : undefined}
      actions={<>
        <div className="segmented" role="group" aria-label="View">
          <button type="button" aria-pressed={view === "visual"} onClick={() => updateQuery({ view: null })}>Visual</button>
          <button type="button" aria-pressed={view === "document"} onClick={() => updateQuery({ view: "document" })}>Document</button>
        </div>
        <button type="button" onClick={() => { void validate(config).then(() => setValidated(new Date().toLocaleTimeString())); store().select({}); }}>Validate</button>
        <button type="button" onClick={() => void exportFile()}>Export</button>
        {run.session ? <button type="button" onClick={() => void endSession()}>End session</button>
          : <button type="button" disabled={run.busy} onClick={() => void ensureSession(save)}>Run</button>}
        <button type="button" onClick={() => store().undo()} disabled={!canUndo} title="Undo (Ctrl+Z)">Undo</button>
        <button type="button" onClick={() => store().redo()} disabled={!canRedo} title="Redo (Ctrl+Y)">Redo</button>
      </>}>
      {validated && <span className="sr-only" role="status">Validated at {validated}</span>}
      {view === "document" ? <DocumentMode /> : (
        <div className="pl-workbench">
          <Group orientation="horizontal" className="pl-panels">
            <Panel id="palette" defaultSize="17" minSize="10"><Palette /></Panel>
            <Separator className="pl-separator" />
            <Panel id="center" defaultSize="58" minSize="30">
              <Group orientation="vertical">
                <Panel id="canvas" defaultSize="66" minSize="25">
                  <div className="pl-canvas-wrap">
                    <div className="pl-toolbar">
                      <span className="muted small">{config.components.length} components</span>
                      <span className="spacer" />
                      <button type="button" onClick={() => { for (const id of Object.keys(store().free)) store().setFree(id, null); requestAnimationFrame(() => void flow.fitView({ padding: 0.15, maxZoom: 1 })); }}>Auto-arrange ring</button>
                      <button type="button" onClick={() => void flow.fitView({ padding: 0.15, maxZoom: 1 })}>Fit</button>
                    </div>
                    <PipelineCanvas />
                  </div>
                </Panel>
                <Separator className="pl-separator horizontal" />
                <Panel id="dock" defaultSize="34" minSize="15"><Dock save={save} /></Panel>
              </Group>
            </Panel>
            <Separator className="pl-separator" />
            <Panel id="right" defaultSize="25" minSize="14"><RightPanel /></Panel>
          </Group>
        </div>
      )}
      <Dialogs />
    </EditorFrame>
  );
}
