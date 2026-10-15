// SPDX-License-Identifier: Apache-2.0
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { applyEdits, filterInfo, filterKind, filtersOf, formatConfig, kindInfo, primaryProxy, ringOrder, PSPP_FORMAT, type PipelineConfig, type Problem } from "@psp-cdl/studio-core";
import { api } from "../../lib/api";
import { jsonRanges, rangeFor, type JsonPath } from "../../pipeline/jsonPaths";
import { usePipelineEditor } from "../../pipeline/store";
import type { EditorMarker } from "./JsonEditor";
import { ProblemList } from "./RightPanel";

const JsonEditor = lazy(() => import("./JsonEditor"));

/**
 * Lenient parse for typing: valid JSON with the base shape applies, so kind-level schema violations
 * show as problems instead of blocking the sync. The `$format` marker of a pasted .pspp is dropped.
 */
export function parseDocument(text: string): { config: PipelineConfig } | { error: string } {
  let value: unknown;
  try { value = JSON.parse(text); } catch (e) { return { error: `Not valid JSON: ${(e as Error).message}` }; }
  if (!value || typeof value !== "object" || Array.isArray(value)) return { error: "The document must be one JSON object." };
  const { $format, ...rest } = value as Record<string, unknown>;
  if ($format !== undefined && $format !== PSPP_FORMAT) return { error: `$format must be ${PSPP_FORMAT}.` };
  if (typeof rest.name !== "string") return { error: "name must be a string." };
  if (rest.psp !== null && (typeof rest.psp !== "object" || Array.isArray(rest.psp) || typeof (rest.psp as { document?: unknown }).document !== "string")) return { error: "psp must be null or an object with a document pointer." };
  if (!Array.isArray(rest.components)) return { error: "components must be an array." };
  for (const [i, c] of rest.components.entries()) {
    if (!c || typeof c !== "object" || Array.isArray(c) || typeof c.id !== "string" || typeof c.kind !== "string" || typeof c.role !== "string") return { error: `components[${i}] needs string id, kind and role.` };
  }
  return { config: rest as unknown as PipelineConfig };
}

/** Where a problem points, as a JSON path into the document. */
export function problemPath(config: PipelineConfig, p: Problem): JsonPath {
  if (p.target?.path) return p.target.path;
  if (p.target?.componentId) { const i = config.components.findIndex(c => c.id === p.target!.componentId); return i >= 0 ? ["components", i] : ["components"]; }
  if (p.target?.psp) return ["psp"];
  return [];
}

export function DocumentMode() {
  const config = usePipelineEditor(s => s.config)!;
  const problems = usePipelineEditor(s => s.problems);
  const selection = usePipelineEditor(s => s.selection);
  const store = usePipelineEditor.getState;
  const [text, setText] = useState(() => formatConfig(config));
  const [syncError, setSyncError] = useState<string | null>(null);
  const [schema, setSchema] = useState<Record<string, unknown> | null>(null);
  const applied = useRef(formatConfig(config));
  useEffect(() => { api.pipelineSchema().then(setSchema).catch(() => {}); }, []);
  // Edits made elsewhere (the canvas, undo, a quick fix) replace the text; our own edits do not loop back.
  useEffect(() => {
    const canonical = formatConfig(config);
    if (canonical !== applied.current) { applied.current = canonical; setText(canonical); setSyncError(null); }
  }, [config]);
  const onChange = (next: string) => {
    setText(next);
    const parsed = parseDocument(next);
    if ("error" in parsed) { setSyncError(parsed.error); return; }
    setSyncError(null);
    applied.current = formatConfig(parsed.config);
    store().apply(parsed.config, "document");
  };
  const ranges = useMemo(() => jsonRanges(text), [text]);
  const markers = useMemo<EditorMarker[]>(() => {
    if (!ranges) return [];
    return problems.filter(p => p.severity !== "info").map(p => {
      const r = rangeFor(ranges, problemPath(config, p)) ?? { start: 0, end: 1 };
      return { start: r.start, end: r.end, severity: p.severity, message: p.message, ...(p.fix ? { fix: { label: p.fix.label, run: () => store().apply(c => applyEdits(c, p.fix!.edits)) } } : {}) };
    });
  }, [problems, ranges, config]); // eslint-disable-line react-hooks/exhaustive-deps
  const highlight = useMemo(() => {
    if (!ranges) return null;
    const i = selection.componentId ? config.components.findIndex(c => c.id === selection.componentId) : selection.filter ? config.components.findIndex(c => c.id === selection.filter!.componentId) : -1;
    const path: JsonPath | null = selection.filter && i >= 0 ? ["components", i, "filters", selection.filter.side, selection.filter.index] : i >= 0 ? ["components", i] : selection.psp ? ["psp"] : null;
    return path ? rangeFor(ranges, path) : null;
  }, [ranges, selection, config]);

  return (
    <div className="pl-document">
      <div className="pl-document-editor">
        <Suspense fallback={<p className="muted">Loading the editor…</p>}>
          <JsonEditor value={text} onChange={onChange} schema={schema} markers={markers} highlight={highlight} ariaLabel="Pipeline configuration JSON" />
        </Suspense>
      </div>
      <aside className="pl-right" aria-label="Document">
        <section aria-label="Sync status">
          <h3>Sync</h3>
          {syncError ? <p className="pl-sync out" role="status">Out of sync: {syncError} The canvas shows the last version that parsed.</p> : <p className="pl-sync in" role="status">In sync with the canvas.</p>}
        </section>
        <section aria-label="Outline"><h3>Outline</h3><Outline /></section>
        <section aria-label="Document problems"><h3>Problems</h3><ProblemList problems={problems} onSelect={p => {
          const id = p.target?.componentId;
          if (p.target?.filter) store().select({ filter: p.target.filter }); else if (id) store().select({ componentId: id }); else if (p.target?.psp) store().select({ psp: true });
        }} /></section>
      </aside>
    </div>
  );
}

/** Ring order, LLMProxy with its filter arrays, the loop, auxiliaries and terminals. */
function Outline() {
  const config = usePipelineEditor(s => s.config)!;
  const selection = usePipelineEditor(s => s.selection);
  const select = usePipelineEditor(s => s.select);
  const proxy = primaryProxy(config);
  const item = (id: string, label: string) => (
    <button type="button" className={selection.componentId === id ? "selected" : undefined} onClick={() => select({ componentId: id })}>{label}</button>
  );
  const name = (id: string) => { const c = config.components.find(x => x.id === id); return c ? `${kindInfo(c.kind)?.label ?? c.kind} · ${c.id}` : id; };
  return (
    <ul className="pl-outline">
      <li><button type="button" className={selection.psp ? "selected" : undefined} onClick={() => select({ psp: true })}>PSP · {config.psp?.document ?? "none"}</button></li>
      <li>Ring
        <ol>{ringOrder(config).map((node, i) => {
          const id = node.replace(/\.(request|response)$/, "");
          return <li key={`${i}:${node}`}>{item(id, `${name(id)}${node !== id ? ` (${node.slice(id.length + 1)})` : ""}`)}</li>;
        })}</ol>
      </li>
      {proxy && <li>{item(proxy.id, `Filters · ${proxy.id}`)}
        {(["request", "response"] as const).map(side => (
          <ul key={side}><li>{side}<ol>{filtersOf(proxy, side).map((s, i) => (
            <li key={i}><button type="button" onClick={() => select({ filter: { componentId: proxy.id, side, index: i } })}>{filterInfo(filterKind(s))?.label ?? filterKind(s)}</button></li>
          ))}</ol></li></ul>
        ))}
      </li>}
      <li>Loop<ul>{config.components.filter(c => c.role === "loop").map(c => <li key={c.id}>{item(c.id, name(c.id))}</li>)}</ul></li>
      <li>Auxiliary<ul>{config.components.filter(c => c.role === "aux").map(c => <li key={c.id}>{item(c.id, name(c.id))}</li>)}</ul></li>
      <li>Terminals<ul>{config.components.filter(c => c.role === "terminal").map(c => <li key={c.id}>{item(c.id, name(c.id))}</li>)}</ul></li>
    </ul>
  );
}
