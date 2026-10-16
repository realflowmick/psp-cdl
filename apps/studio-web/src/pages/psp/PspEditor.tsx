// SPDX-License-Identifier: Apache-2.0
// The diagram editor and its diagram library load on demand, when a PSP file is opened.
import { useEffect, useMemo, useRef, useState } from "react";
import { ReactFlowProvider, useReactFlow } from "@xyflow/react";
import { Field, TextArea } from "../../components/fields";
import { EditorFrame, Loading, Notice, NotFound } from "../../components/Page";
import { useStudio } from "../../data";
import { api } from "../../lib/api";
import { errorText } from "../../lib/format";
import { Link, navigate, updateQuery, useLocation } from "../../router";
import { isPspxPath } from "@psp-cdl/studio-core";
import { fileHref } from "../scenarios/ScenarioForms";
import { ExportDialog } from "./Transfer";
import {
  addNode as insertNode, addTransition, childNodes, defaultScope, deleteNode as removeNode, deleteTransition, formatPsp, parsePsp,
  patchTransition, renameNode, resolveScope, scopeGraph, scopeKeys, uniqueKey, type Document, type GraphEdge
} from "../../psp/model";
import { createNode, NODE_KINDS } from "../../psp/kinds";
import { autoLayout, layoutPath, parseLayout, positionsFor, scopeId, serializeLayout, type Layout, type Point } from "../../psp/layout";
import { Canvas } from "./Canvas";
import { EditorContext, parseSelection, selectionParam, useSnapshotHistory, type EditorApi, type Selection, type Snapshot } from "./editor";
import { Inspector } from "./Inspector";
import { Sidebar } from "./Sidebar";

/** The system prompt part of a .pspx, kept unchanged while the application part is edited. */
interface Wrapper { system: string; interpreter: string }

/** Loads the PSP text (the application part of a .pspx) and its layout sidecar, then hands both to the editor. */
export default function PspEditor({ path }: { path: string }) {
  const [loaded, setLoaded] = useState<{ snapshot: Snapshot; wrapper: Wrapper | null } | null>(null);
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    Promise.all([api.readFile(path), api.readFile(layoutPath(path)).then(f => f.text, () => null)])
      .then(async ([file, layout]) => {
        let text = file.text, wrapper: Wrapper | null = null;
        if (isPspxPath(path)) {
          try {
            const parts = await api.pspxUnpack(file.text);
            text = parts.application; wrapper = { system: parts.system, interpreter: parts.manifest.interpreter };
          } catch (e) { if (!cancelled) setError(errorText(e)); return; }
        }
        if (!cancelled) setLoaded({ snapshot: { text, layout: parseLayout(layout) }, wrapper });
      })
      .catch(() => { if (!cancelled) setMissing(true); });
    return () => { cancelled = true; };
  }, [path]);
  if (missing) return <NotFound what="PSP file" back={{ label: "PSP applications", to: "/psp" }} />;
  if (error) return <div className="page"><Notice kind="error">This .pspx could not be read: {error} <Link to={fileHref(path)}>Open it as text</Link></Notice></div>;
  if (!loaded) return <Loading />;
  return <ReactFlowProvider><LoadedEditor path={path} initial={loaded.snapshot} wrapper={loaded.wrapper} /></ReactFlowProvider>;
}

const isTyping = (target: EventTarget | null) => target instanceof HTMLElement && (["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) || target.isContentEditable);

function LoadedEditor({ path, initial, wrapper }: { path: string; initial: Snapshot; wrapper: Wrapper | null }) {
  const { refreshFiles } = useStudio();
  const history = useSnapshotHistory(initial);
  const { present, undo, redo } = history;
  const parsed = useMemo(() => parsePsp(present.text), [present.text]);
  const location = useLocation();
  const view = location.search.get("view") === "source" || !parsed.ok ? "source" : "diagram";
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || isTyping(e.target)) return;
      const k = e.key.toLowerCase();
      if (k === "z" && !e.shiftKey) { e.preventDefault(); undo(); }
      else if (k === "y" || (k === "z" && e.shiftKey)) { e.preventDefault(); redo(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo]);

  const save = async () => {
    if (!parsed.ok && !window.confirm("The markup does not parse. Save it anyway?")) return;
    setSaving(true); setError(null);
    try {
      const snapshot = present;
      if (snapshot.text !== history.saved.text) {
        // A .pspx is repacked around its original system prompt; only the application part changes.
        const text = wrapper ? (await api.pspxPack({ application: snapshot.text, name: path, system: wrapper.system, interpreter: wrapper.interpreter })).text : snapshot.text;
        await api.writeFile(path, text);
      }
      const layout = serializeLayout(snapshot.layout);
      if (layout !== serializeLayout(history.saved.layout)) await api.writeFile(layoutPath(path), layout);
      history.markSaved(snapshot);
      void refreshFiles();
    } catch (e) { setError(errorText(e)); } finally { setSaving(false); }
  };
  return (
    <EditorFrame className="fill" crumbs={[{ label: "PSP applications", to: "/psp" }, { label: path }]} title={<code>{path}</code>}
      badge={wrapper ? <span className="badge info" title={`Edits the application part. The ${wrapper.interpreter} system prompt before it is kept unchanged.`}>pspx</span> : undefined}
      dirty={history.dirty} saving={saving} error={error} onSave={() => void save()} onRevert={() => history.commit(history.saved)}
      actions={<>
        <button type="button" onClick={() => setExporting(true)}>Export</button>
        <button type="button" onClick={() => navigate(`/psp/assistant?file=${encodeURIComponent(path)}`)}>History</button>
        <button type="button" onClick={undo} disabled={!history.canUndo} title="Undo (Ctrl+Z)">Undo</button>
        <button type="button" onClick={redo} disabled={!history.canRedo} title="Redo (Ctrl+Y)">Redo</button>
        <div className="segmented" role="group" aria-label="View">
          <button type="button" aria-pressed={view === "diagram"} disabled={!parsed.ok} onClick={() => updateQuery({ view: null })}>Diagram</button>
          <button type="button" aria-pressed={view === "source"} onClick={() => updateQuery({ view: "source" })}>Source</button>
        </div>
      </>}>
      {view === "source" || !parsed.ok ? (
        <div className="psp-source">
          {!parsed.ok && <Notice kind="error">The markup does not parse: {parsed.error} at line {parsed.line}, column {parsed.column}. The diagram returns once it does.</Notice>}
          <Field label="PSP source" hint="Undo and redo also cover edits made here."><TextArea code rows={30} value={present.text} onChange={v => history.commit(p => ({ ...p, text: v }), "source")} /></Field>
        </div>
      ) : <DiagramEditor path={path} doc={parsed.doc} history={history} />}
      {exporting && <ExportDialog path={path} application={present.text} system={wrapper?.system ?? null} interpreter={wrapper?.interpreter ?? null} onClose={() => setExporting(false)} />}
    </EditorFrame>
  );
}

type History = ReturnType<typeof useSnapshotHistory>;
const renameInLayout = (layout: Layout, scope: string[], from: string, to: string): Layout => {
  const out: Layout = {}, here = scopeId(scope), prefix = scopeId([...scope, from]), replacement = scopeId([...scope, to]);
  for (const [id, nodes] of Object.entries(layout)) {
    let key = id;
    if (id === prefix || id.startsWith(prefix + "/")) key = replacement + id.slice(prefix.length);
    const copy = { ...nodes };
    if (id === here && copy[from]) { copy[to] = copy[from]!; delete copy[from]; }
    out[key] = copy;
  }
  return out;
};
const dropFromLayout = (layout: Layout, scope: string[], key: string): Layout => {
  const out: Layout = {}, here = scopeId(scope), prefix = scopeId([...scope, key]);
  for (const [id, nodes] of Object.entries(layout)) {
    if (id === prefix || id.startsWith(prefix + "/")) continue;
    const copy = { ...nodes };
    if (id === here) delete copy[key];
    out[id] = copy;
  }
  return out;
};

function DiagramEditor({ path, doc, history }: { path: string; doc: Document; history: History }) {
  const location = useLocation();
  const flow = useReactFlow();
  const [notice, setNotice] = useState<string | null>(null);
  const dragStart = useRef<Snapshot | null>(null);
  const { present, commit } = history;

  const scopeParam = location.search.get("scope");
  let scope = scopeParam === null ? defaultScope(doc) : scopeParam.split("/").filter(Boolean);
  let scopePath = resolveScope(doc, scope);
  if (!scopePath) { scope = defaultScope(doc); scopePath = resolveScope(doc, scope) ?? []; }
  const sid = scopeId(scope);
  const graph = useMemo(() => scopeGraph(doc, scopePath!), [doc, scopePath.join(".")]); // eslint-disable-line react-hooks/exhaustive-deps
  const keys = useMemo(() => [...graph.nodes.map(n => n.key), ...graph.missing], [graph]);
  const positions = useMemo(() => positionsFor(present.layout[sid], keys, graph.edges), [present.layout, sid, keys, graph.edges]);
  const selection = parseSelection(location.search.get("sel"));
  const tab = location.search.get("tab") ?? "";

  const select = (next: Selection, nextTab?: string) => updateQuery({ sel: selectionParam(next), ...(nextTab !== undefined ? { tab: nextTab || null } : {}) });
  const edit = (change: (doc: Document) => Document, coalesce?: string, layout?: (layout: Layout) => Layout): boolean => {
    try {
      const next = change(doc);
      if (next === doc && !layout) return true;
      commit(p => ({ text: next === doc ? p.text : formatPsp(next), layout: layout ? layout(p.layout) : p.layout }), coalesce);
      setNotice(null);
      return true;
    } catch (e) { setNotice(errorText(e)); return false; }
  };
  /** The scope's current positions become stored ones, so adding a node never shuffles the rest. */
  const pinned = (layout: Layout, extra: Record<string, Point> = {}): Layout => ({ ...layout, [sid]: { ...positions, ...layout[sid], ...extra } });

  const api: EditorApi = {
    file: path, doc, graph, scope, scopePath, selection, tab, positions,
    setTab: t => updateQuery({ tab: t || null }),
    select,
    openScope: (next, sel = null) => updateQuery({ scope: next.join("/"), sel: selectionParam(sel) }),
    apply: (change, coalesce) => { edit(change, coalesce); },
    rename: (node, to) => {
      const parent = node.path.slice(0, -1), parentScope = scopeKeys(doc, parent);
      if (!edit(d => renameNode(d, parent, node.key, to), `rename:${node.path.join(".")}`, l => renameInLayout(l, parentScope, node.key, to))) return;
      const patch: Record<string, string | null> = {};
      const depth = parentScope.length;
      if (scope.length > depth && scope[depth] === node.key && parentScope.every((k, i) => scope[i] === k)) patch.scope = [...scope.slice(0, depth), to, ...scope.slice(depth + 1)].join("/");
      if (selection?.kind === "node" && selection.key === node.key && scopeId(parentScope) === sid) patch.sel = selectionParam({ kind: "node", key: to });
      if (Object.keys(patch).length) updateQuery(patch);
    },
    addNode: (type, at, id) => {
      const kind = NODE_KINDS.find(k => k.type === type);
      if (!kind) { setNotice(`Unknown node type ${type}.`); return; }
      const key = id ?? uniqueKey(keys, type);
      const placed = at ?? positionsFor(present.layout[sid] ?? positions, [...keys, key], graph.edges)[key]!;
      if (edit(d => insertNode(d, scopePath!, createNode(kind, key, scopePath!.length)).doc, undefined, l => pinned(l, { [key]: placed }))) select({ kind: "node", key });
    },
    deleteNode: key => {
      const node = graph.nodes.find(n => n.key === key);
      const children = node ? childNodes(doc, node.path).length : 0;
      if (children && !window.confirm(`Delete ${key} and the ${children} node${children === 1 ? "" : "s"} inside it?`)) return;
      if (edit(d => removeNode(d, scopePath!, key), undefined, l => dropFromLayout(l, scope, key))) select(null);
    },
    connect: (source, target) => {
      let key = "";
      if (edit(d => { const r = addTransition(d, scopePath!, source, target); key = r.key; return r.doc; })) select({ kind: "edge", key });
    },
    retarget: (e: GraphEdge, target) => { edit(d => patchTransition(d, e, { target_node: target })); },
    deleteEdge: e => { if (edit(d => deleteTransition(d, e))) select(null); },
    moveNode: (key, to, dragging) => {
      if (dragging) history.preview(p => ({ ...p, layout: pinned(p.layout, { [key]: to }) }));
      else commit(p => ({ ...p, layout: pinned(p.layout, { [key]: to }) }), `move:${key}`);
    },
    startDrag: () => { dragStart.current = present; },
    endDrag: () => { if (dragStart.current) history.checkpoint(dragStart.current); dragStart.current = null; },
    autoLayout: () => {
      commit(p => ({ ...p, layout: { ...p.layout, [sid]: autoLayout(keys, graph.edges) } }));
      requestAnimationFrame(() => void flow.fitView({ padding: 0.2, maxZoom: 1.1 }));
    },
    report: setNotice
  };

  const root = path.slice(path.lastIndexOf("/") + 1);
  return (
    <EditorContext.Provider value={api}>
      {notice && <Notice kind="warn">{notice} <button type="button" onClick={() => setNotice(null)}>Dismiss</button></Notice>}
      <div className="psp-editor">
        <Sidebar />
        <div className="psp-main">
          <div className="psp-toolbar">
            <nav className="crumbs" aria-label="Scope">
              {[root, ...scope].map((label, i) => (
                <span key={i}>
                  {i === scope.length ? <span aria-current="page">{label}</span>
                    : <button type="button" onClick={() => api.openScope(scope.slice(0, i))}>{label}</button>}
                  {i < scope.length && <span className="sep" aria-hidden="true">›</span>}
                </span>
              ))}
            </nav>
            <span className="spacer" />
            <span className="muted small">{graph.nodes.length} nodes · {graph.edges.length} transitions</span>
            <button type="button" onClick={api.autoLayout}>Auto layout</button>
            <button type="button" onClick={() => void flow.fitView({ padding: 0.2, maxZoom: 1.1 })}>Fit</button>
          </div>
          <Canvas />
        </div>
        <Inspector />
      </div>
    </EditorContext.Provider>
  );
}
