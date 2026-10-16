// SPDX-License-Identifier: Apache-2.0
import { lazy, Suspense, useMemo, useState } from "react";
import { DataGrid, type Column } from "../../components/DataGrid";
import { Field, FormGrid, TextInput } from "../../components/fields";
import { EditorFrame, ListPage, Loading, Section } from "../../components/Page";
import { useStudio } from "../../data";
import { api, type WorkspaceFile } from "../../lib/api";
import { errorText, formatBytes, formatTime } from "../../lib/format";
import { navigate } from "../../router";
import { applicationTemplate } from "../../psp/kinds";
import { fileHref, pspHref } from "../scenarios/ScenarioForms";
import { usages } from "../workspace/WorkspacePages";
import { isPspxPath } from "@psp-cdl/studio-core";
import { AssistantDialog } from "./AssistantDialog";
import { ExportDialog, ImportDialog } from "./Transfer";

const LazyEditor = lazy(() => import("./PspEditor"));
/** The diagram editor route. Its chunk, with the diagram library, loads when a file is opened. */
export function PspEditor({ path }: { path: string }) {
  return <Suspense fallback={<Loading />}><LazyEditor path={path} /></Suspense>;
}

type Dialog = { kind: "assistant"; path: string | null } | { kind: "import" } | { kind: "export"; path: string } | null;

export function PspList() {
  const { files, filesLoaded, refreshFiles, collections, status } = useStudio();
  const [dialog, setDialog] = useState<Dialog>(null);
  const rows = useMemo(() => files.filter(f => /\.pspx?$/i.test(f.path)), [files]);
  const columns: Column<WorkspaceFile>[] = [
    { key: "path", header: "Path", value: f => f.path, render: f => <code>{f.path}</code> },
    { key: "format", header: "Format", width: "80px", value: f => isPspxPath(f.path) ? "pspx" : "psp" },
    { key: "size", header: "Size", width: "100px", align: "right", value: f => f.bytes, render: f => formatBytes(f.bytes) },
    { key: "modified", header: "Modified", width: "170px", value: f => f.modifiedAt, render: f => formatTime(f.modifiedAt) },
    { key: "used", header: "Used by", width: "100px", align: "right", value: f => usages(collections, f.path).length }
  ];
  return (
    <ListPage title="PSP applications" subtitle={<>PSP application files under <code>{status?.workspace ?? "the workspace folder"}</code>: <code>.psp</code> holds an application, <code>.pspx</code> holds the interpreter system prompt followed by the application. Double-click one to open it in the diagram editor.</>}>
      <DataGrid id="psp-files" label="PSP applications" fill rows={rows} columns={columns} rowKey={f => f.path} loading={!filesLoaded}
        initialSort={{ key: "path", dir: "asc" }} onOpen={f => navigate(pspHref(f.path))} emptyMessage="No .psp or .pspx files in the workspace yet."
        actions={selected => <>
          <button type="button" className="primary" onClick={() => setDialog({ kind: "assistant", path: selected?.path ?? null })}>AI assistant</button>
          <button type="button" onClick={() => navigate("/psp/new")}>New application</button>
          <button type="button" onClick={() => setDialog({ kind: "import" })}>Import</button>
          <button type="button" disabled={!selected} onClick={() => selected && setDialog({ kind: "export", path: selected.path })}>Export</button>
          <button type="button" disabled={!selected} onClick={() => selected && navigate(fileHref(selected.path))}>Open as text</button>
          <button type="button" onClick={() => navigate(selected ? `/psp/assistant?file=${encodeURIComponent(selected.path)}` : "/psp/assistant")}>History</button>
          <button type="button" onClick={() => void refreshFiles()}>Refresh</button>
        </>} />
      {dialog?.kind === "assistant" && <AssistantDialog path={dialog.path} onClose={() => setDialog(null)} />}
      {dialog?.kind === "import" && <ImportDialog onClose={() => setDialog(null)} />}
      {dialog?.kind === "export" && <ExportDialog path={dialog.path} onClose={() => setDialog(null)} />}
    </ListPage>
  );
}

export function PspNew() {
  const { files, refreshFiles } = useStudio();
  const [file, setFile] = useState("new-application.psp");
  const [name, setName] = useState("new_application");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const problem = !/\.pspx?$/i.test(file) ? "The path must end in .psp or .pspx." : files.some(f => f.path === file) ? `${file} already exists.` : !name || /\s/.test(name) ? "Name the application without spaces." : null;
  const create = async () => {
    if (problem) { setError(problem); return; }
    setSaving(true); setError(null);
    try {
      const text = applicationTemplate(name);
      const written = await api.writeFile(file, isPspxPath(file) ? (await api.pspxPack({ application: text, name: file })).text : text);
      void refreshFiles();
      navigate(pspHref(written.path), { replace: true, force: true });
    } catch (e) { setError(errorText(e)); setSaving(false); }
  };
  return (
    <EditorFrame crumbs={[{ label: "PSP applications", to: "/psp" }, { label: "New application" }]} title="New PSP application" isNew dirty={false} saving={saving}
      error={error} onSave={() => void create()} onRevert={() => undefined}>
      <Section title="Application">
        <FormGrid>
          <Field label="Path" hint="Relative to the workspace folder. End it in .pspx to store the interpreter system prompt with the application."><TextInput value={file} onChange={setFile} /></Field>
          <Field label="Application name" hint="The application node's name attribute."><TextInput value={name} onChange={setName} /></Field>
        </FormGrid>
        {problem && <p className="field-error">{problem}</p>}
      </Section>
      <Section title="Starts as"><pre className="json">{applicationTemplate(name || "application")}</pre></Section>
    </EditorFrame>
  );
}
