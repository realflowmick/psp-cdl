// SPDX-License-Identifier: Apache-2.0
import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { newPipeline, parsePspp, psppFileName, type PipelineConfig, type PipelineSummary } from "@psp-cdl/studio-core";
import { DataGrid, type Column } from "../../components/DataGrid";
import { Field, FormGrid, TextInput } from "../../components/fields";
import { Modal } from "../../components/Modal";
import { KeyValue, ListPage, Loading, Notice } from "../../components/Page";
import { useStudio } from "../../data";
import { api, ApiError } from "../../lib/api";
import { download, readAsText } from "../../lib/files";
import { errorText, formatTime } from "../../lib/format";
import { href, navigate } from "../../router";

const LazyEditor = lazy(() => import("./PipelineEditor"));
/** The detail route. Its chunk, with the diagram library and Monaco, loads when a pipeline is opened. */
export function PipelineEditorPage({ id }: { id: string }) {
  return <Suspense fallback={<Loading />}><LazyEditor id={id} /></Suspense>;
}
export const pipelineHref = (id: string) => href("pipelines", id);

type Dialog = { kind: "new" } | { kind: "import" } | null;

/** Saved pipeline configurations. Double-click or Edit opens the detail route. */
export function PipelinesList() {
  const { report } = useStudio();
  const [rows, setRows] = useState<PipelineSummary[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [dialog, setDialog] = useState<Dialog>(null);
  const [busy, setBusy] = useState(false);
  const refresh = useCallback(() => api.pipelines().then(p => { setRows(p); setLoaded(true); setChecked(c => new Set([...c].filter(id => p.some(r => r.id === id)))); }).catch(report), [report]);
  useEffect(() => { void refresh(); }, [refresh]);

  const toggle = (id: string) => setChecked(c => { const next = new Set(c); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const columns: Column<PipelineSummary>[] = [
    { key: "check", header: "", width: "36px", sortable: false, value: r => checked.has(r.id),
      render: r => <input type="checkbox" aria-label={`Select ${r.name}`} checked={checked.has(r.id)} onClick={e => e.stopPropagation()} onDoubleClick={e => e.stopPropagation()} onChange={() => toggle(r.id)} /> },
    { key: "name", header: "Name", value: r => r.name, render: r => <strong>{r.name}</strong> },
    { key: "description", header: "Description", value: r => r.description ?? "" },
    { key: "psp", header: "PSP", value: r => r.pspRef ?? "", render: r => r.pspRef ? <code>{r.pspRef}</code> : null },
    { key: "updated", header: "Updated", width: "170px", value: r => r.updatedAt, render: r => formatTime(r.updatedAt) }
  ];
  const run = async (work: () => Promise<unknown>) => { setBusy(true); try { await work(); } catch (e) { report(e); } finally { setBusy(false); } };
  const exportRows = (targets: PipelineSummary[]) => run(async () => {
    // One .pspp per selected row.
    for (const target of targets) { const file = await api.exportPipeline(target.id); download(file.name, file.text, "application/json;charset=utf-8"); }
  });
  const remove = (target: PipelineSummary) => {
    if (!window.confirm(`Delete the pipeline ${target.name}? Its MCPProxy baselines go with it.`)) return;
    void run(async () => { await api.deletePipeline(target.id); await refresh(); });
  };
  return (
    <ListPage title="Pipelines" subtitle={<>Saved pipeline configurations: the services a PSP runs on and how they are wired. A configuration references a PSP (or none) and travels as a <code>.pspp</code> file through Import and Export. Double-click one, or select it and choose Edit, to open it.</>}>
      <DataGrid id="pipelines" label="Pipelines" fill rows={rows} columns={columns} rowKey={r => r.id} loading={!loaded} openLabel="Edit"
        initialSort={{ key: "name", dir: "asc" }} onOpen={r => navigate(pipelineHref(r.id))} emptyMessage="No pipelines yet. New creates an empty ring; Import reads a .pspp file."
        actions={selected => {
          const targets = checked.size ? rows.filter(r => checked.has(r.id)) : selected ? [selected] : [];
          return <>
            <button type="button" className="primary" onClick={() => setDialog({ kind: "new" })}>New</button>
            <button type="button" disabled={!selected || busy} onClick={() => selected && void run(async () => { const copy = await api.duplicatePipeline(selected.id); await refresh(); navigate(pipelineHref(copy.id)); })}>Duplicate</button>
            <button type="button" className="danger" disabled={!selected || busy} onClick={() => selected && remove(selected)}>Delete</button>
            <button type="button" onClick={() => setDialog({ kind: "import" })}>Import .pspp</button>
            <button type="button" disabled={!targets.length || busy} onClick={() => void exportRows(targets)}>{targets.length > 1 ? `Export ${targets.length} .pspp` : "Export .pspp"}</button>
            <button type="button" onClick={() => void refresh()}>Refresh</button>
          </>;
        }} />
      {dialog?.kind === "new" && <NewDialog names={rows.map(r => r.name)} onClose={() => setDialog(null)} />}
      {dialog?.kind === "import" && <ImportDialog onClose={() => setDialog(null)} onImported={id => { void refresh(); setDialog(null); navigate(pipelineHref(id)); }} />}
    </ListPage>
  );
}

function NewDialog({ names, onClose }: { names: string[]; onClose(): void }) {
  const suggested = useMemo(() => { for (let n = 1; ; n++) if (!names.some(x => x.toLowerCase() === `pipeline-${n}`)) return `pipeline-${n}`; }, [names]);
  const [name, setName] = useState(suggested);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const problem = !name.trim() ? "Name the pipeline." : names.some(n => n.toLowerCase() === name.trim().toLowerCase()) ? "Another pipeline has this name." : /[\\/:*?"<>|]/.test(name) ? "Names become file names: avoid \\ / : * ? \" < > |." : null;
  const create = async () => {
    setBusy(true); setError(null);
    try { const row = await api.createPipeline(newPipeline(name.trim())); onClose(); navigate(pipelineHref(row.id)); }
    catch (e) { setError(errorText(e)); setBusy(false); }
  };
  return (
    <Modal title="New pipeline" onClose={onClose}
      footer={<><button type="button" onClick={onClose}>Cancel</button><button type="button" className="primary" disabled={!!problem || busy} onClick={() => void create()}>Create</button></>}>
      {error && <Notice kind="error">{error}</Notice>}
      <Field label="Name" hint={`Unique. Export writes ${psppFileName(name || "name")}.`} error={problem}><TextInput value={name} onChange={setName} /></Field>
      <p className="muted small">Starts as an empty ring: a chat Initiator with a sink, LLMProxy and a Model, with no PSP.</p>
    </Modal>
  );
}

/** Reads a .pspp, validates it against the schema, and resolves a name collision by renaming or overwriting. */
export function ImportDialog({ onClose, onImported }: { onClose(): void; onImported(id: string): void }) {
  const [source, setSource] = useState<{ name: string; text: string; config: PipelineConfig | null; error: string | null } | null>(null);
  const [conflict, setConflict] = useState<string | null>(null);
  const [mode, setMode] = useState<"rename" | "overwrite">("rename");
  const [rename, setRename] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pick = async (file: File | undefined) => {
    if (!file) return;
    setError(null); setConflict(null);
    const text = await readAsText(file);
    try { const config = parsePspp(text); setSource({ name: file.name, text, config, error: null }); setRename(`${config.name} (2)`); }
    catch (e) { setSource({ name: file.name, text, config: null, error: [(e as Error).message, ...((e as { issues?: string[] }).issues ?? [])].join(" ") }); }
  };
  const submit = async () => {
    if (!source?.config) return;
    setBusy(true); setError(null);
    try {
      const result = conflict ? await api.importPipeline(source.text, mode, mode === "rename" ? rename : undefined) : await api.importPipeline(source.text);
      onImported(result.row.id);
    } catch (e) {
      if (e instanceof ApiError && e.code === "NAME_CONFLICT") setConflict(source.config.name);
      else setError(errorText(e));
      setBusy(false);
    }
  };
  return (
    <Modal title="Import a pipeline" onClose={onClose}
      footer={<><button type="button" onClick={onClose} disabled={busy}>Cancel</button><button type="button" className="primary" disabled={!source?.config || busy} onClick={() => void submit()}>{conflict ? (mode === "rename" ? "Import renamed" : "Overwrite") : "Import"}</button></>}>
      {error && <Notice kind="error">{error}</Notice>}
      <Field label="File" hint="A .pspp file: the configuration JSON with $format pspp/1.">
        <input type="file" accept=".pspp,application/json" aria-label="Pipeline file" onChange={e => void pick(e.target.files?.[0])} />
      </Field>
      {source?.error && <Notice kind="error">{source.name} does not match the pipeline schema: {source.error}</Notice>}
      {source?.config && <KeyValue items={[["Name", source.config.name], ["Description", source.config.description ?? ""], ["PSP", source.config.psp?.document ?? "none"], ["Components", String(source.config.components.length)]]} />}
      {conflict && (
        <fieldset className="choice">
          <legend>A pipeline named {conflict} exists</legend>
          <label className="check"><input type="radio" name="conflict" checked={mode === "rename"} onChange={() => setMode("rename")} /> Import as a new pipeline named</label>
          {mode === "rename" && <FormGrid><Field label="New name"><TextInput value={rename} onChange={setRename} /></Field></FormGrid>}
          <label className="check"><input type="radio" name="conflict" checked={mode === "overwrite"} onChange={() => setMode("overwrite")} /> Overwrite it (keeps its id)</label>
        </fieldset>
      )}
    </Modal>
  );
}
