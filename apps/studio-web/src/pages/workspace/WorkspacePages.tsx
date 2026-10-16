// SPDX-License-Identifier: Apache-2.0
import { useEffect, useMemo, useState } from "react";
import type { ScenarioCollection } from "@psp-cdl/studio-core";
import { DataGrid, type Column } from "../../components/DataGrid";
import { Field, FormGrid, TextArea, TextInput } from "../../components/fields";
import { EditorFrame, ListPage, Loading, NotFound, Section } from "../../components/Page";
import { useStudio } from "../../data";
import { api, type WorkspaceFile } from "../../lib/api";
import { useDraft } from "../../lib/draft";
import { errorText, formatBytes, formatTime } from "../../lib/format";
import { navigate } from "../../router";
import { ScenarioLinksGrid } from "../scenarios/RecordEditors";
import { fileHref, pspHref } from "../scenarios/ScenarioForms";

/** Scenarios whose live-loop application reads this workspace file. */
export function usages(collections: ScenarioCollection[], path: string) {
  return collections.flatMap(collection => collection.scenarios
    .filter(s => s.kind === "live-loop" && "file" in s.application && s.application.file === path)
    .map(s => ({ collection, scenarioId: s.id, label: s.label })));
}

export function FilesList() {
  const { files, filesLoaded, refreshFiles, collections, status } = useStudio();
  const columns: Column<WorkspaceFile>[] = [
    { key: "path", header: "Path", value: f => f.path, render: f => <code>{f.path}</code> },
    { key: "type", header: "Type", width: "80px", value: f => f.path.slice(f.path.lastIndexOf(".") + 1) },
    { key: "size", header: "Size", width: "100px", align: "right", value: f => f.bytes, render: f => formatBytes(f.bytes) },
    { key: "modified", header: "Modified", width: "170px", value: f => f.modifiedAt, render: f => formatTime(f.modifiedAt) },
    { key: "used", header: "Used by", width: "100px", align: "right", value: f => usages(collections, f.path).length }
  ];
  return (
    <ListPage title="Workspace files" subtitle={<>Application files under <code>{status?.workspace ?? "the workspace folder"}</code>. Double-click a file to edit it.</>}>
      <DataGrid id="files" label="Workspace files" fill rows={files} columns={columns} rowKey={f => f.path} loading={!filesLoaded}
        initialSort={{ key: "path", dir: "asc" }} onOpen={f => navigate(fileHref(f.path))} emptyMessage="No .psp, .md, .txt or .json files in the workspace."
        actions={() => <>
          <button type="button" className="primary" onClick={() => navigate("/workspace/new")}>New file</button>
          <button type="button" onClick={() => void refreshFiles()}>Refresh</button>
        </>} />
    </ListPage>
  );
}

interface FileDraft { path: string; text: string }

export function FileEditor({ path }: { path: string | null }) {
  const { collections, refreshFiles } = useStudio();
  const isNew = path === null;
  const [loaded, setLoaded] = useState<FileDraft | undefined>(isNew ? { path: "new-application.psp", text: "" } : undefined);
  const [missing, setMissing] = useState(false);
  const [meta, setMeta] = useState<{ bytes: number; modifiedAt: string } | null>(null);
  useEffect(() => {
    if (path === null) return;
    let cancelled = false;
    api.readFile(path).then(f => { if (!cancelled) { setLoaded({ path: f.path, text: f.text }); setMeta({ bytes: f.bytes, modifiedAt: f.modifiedAt }); } })
      .catch(() => { if (!cancelled) setMissing(true); });
    return () => { cancelled = true; };
  }, [path]);
  const { draft, dirty, update, markSaved, revert } = useDraft(loaded);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const used = useMemo(() => path ? usages(collections, path) : [], [collections, path]);
  if (missing) return <NotFound what="File" back={{ label: "workspace files", to: "/workspace" }} />;
  if (!draft) return <Loading />;
  const lines = draft.text ? draft.text.split("\n").length : 0;
  const save = async () => {
    setSaving(true); setError(null);
    try {
      const written = await api.writeFile(draft.path, draft.text);
      markSaved(draft); setMeta({ bytes: written.bytes, modifiedAt: written.modifiedAt });
      void refreshFiles();
      if (isNew) navigate(fileHref(written.path), { replace: true, force: true });
    } catch (e) { setError(errorText(e)); } finally { setSaving(false); }
  };
  return (
    <EditorFrame crumbs={[{ label: "Workspace files", to: "/workspace" }, { label: isNew ? "New file" : draft.path }]}
      title={isNew ? "New file" : <code>{draft.path}</code>}
      subtitle={meta ? `${formatBytes(meta.bytes)} · ${lines} lines · modified ${formatTime(meta.modifiedAt)}` : `${lines} lines`}
      dirty={dirty} saving={saving} isNew={isNew} error={error} onSave={() => void save()} onRevert={revert}
      actions={!isNew && draft.path.toLowerCase().endsWith(".psp") ? <button type="button" onClick={() => navigate(pspHref(draft.path))}>Open in PSP editor</button> : undefined}>
      {isNew && (
        <Section title="Location">
          <FormGrid><Field label="Path" hint="Relative to the workspace folder, with forward slashes. Allowed: .psp, .md, .txt, .json."><TextInput value={draft.path} onChange={v => update(d => ({ ...d, path: v }))} /></Field></FormGrid>
        </Section>
      )}
      <Section title="Content">
        <Field label="Text" wide><TextArea code rows={30} value={draft.text} onChange={v => update(d => ({ ...d, text: v }))} /></Field>
      </Section>
      {!isNew && <Section title="Used by scenarios"><ScenarioLinksGrid id={`file:${draft.path}:usages`} rows={used} /></Section>}
    </EditorFrame>
  );
}
