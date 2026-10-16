// SPDX-License-Identifier: Apache-2.0
import {
  applyEdits, attachment, filterInfo, filterKind, filterOptionsOf, filtersOf, kindInfo, problemCounts, removeComponent, removeFilter,
  type PipelineConfig, type Problem
} from "@psp-cdl/studio-core";
import { Field, TextArea, TextInput } from "../../components/fields";
import { KeyValue } from "../../components/Page";
import { pspSummaryOf, usePipelineEditor, type Selection } from "../../pipeline/store";

/** Validation results; each one selects its target, and a quick fix applies as one undoable edit. */
export function ProblemList({ problems, onSelect }: { problems: readonly Problem[]; onSelect?: (problem: Problem) => void }) {
  const apply = usePipelineEditor(s => s.apply);
  if (!problems.length) return <p className="muted small">No problems.</p>;
  return (
    <ul className="pl-problems" aria-label="Problems">
      {problems.map(p => (
        <li key={p.id} className={p.severity}>
          <button type="button" className="pl-problem" onClick={() => onSelect?.(p)}>
            <span className={`pl-sev ${p.severity}`}>{p.severity === "error" ? "Error" : p.severity === "warn" ? "Warning" : "OK"}</span>
            <span>{p.message}</span>
          </button>
          {p.fix && <button type="button" className="pl-fix" onClick={() => apply(c => applyEdits(c, p.fix!.edits))}>{p.fix.label}</button>}
        </li>
      ))}
    </ul>
  );
}

export function selectProblem(problem: Problem): void {
  const store = usePipelineEditor.getState();
  const t = problem.target;
  if (t?.filter) store.select({ filter: t.filter });
  else if (t?.componentId) store.select({ componentId: t.componentId });
  else if (t?.psp) store.select({ psp: true });
}

/** "1 ring · 1 bootstrap · 6 filters · 1 loop + backend · 2 auxiliary" */
export function pipelineCounts(config: PipelineConfig): string {
  const ring = config.components.filter(c => c.role === "ring" && attachment(config, c) === "ring").length;
  const filters = config.components.filter(c => c.kind === "llmproxy").reduce((n, c) => n + filtersOf(c, "request").length + filtersOf(c, "response").length, 0);
  const loops = config.components.filter(c => c.role === "loop").length;
  const aux = config.components.filter(c => c.role === "aux").length;
  return [`${ring} ring`, `${config.psp ? 1 : 0} bootstrap`, `${filters} filter${filters === 1 ? "" : "s"}`, `${loops} loop${loops ? " + backend" : ""}`, `${aux} auxiliary`].join(" · ");
}

const LEGEND: [string, string][] = [
  ["Ring", "splices into a path edge. LLMProxy places both halves at once."],
  ["Bootstrap", "attaches to LLMProxy's left side. One PSP Document per session; PSP Context appears with it."],
  ["Filter", "drops only into an LLMProxy half, as an ordered slot."],
  ["Loop", "attaches to the turn and requires a backend."],
  ["Auxiliary", "hangs off LLMProxy. Covenants on data in context can redact what it sees."]
];

export function RightPanel() {
  const config = usePipelineEditor(s => s.config)!;
  const selection = usePipelineEditor(s => s.selection);
  const problems = usePipelineEditor(s => s.problems);
  if (selection.filter) return <aside className="pl-right" aria-label="Details"><FilterDetails selection={selection} /></aside>;
  if (selection.componentId && config.components.some(c => c.id === selection.componentId)) return <aside className="pl-right" aria-label="Details"><ComponentDetails id={selection.componentId} /></aside>;
  if (selection.psp) return <aside className="pl-right" aria-label="Details"><PspDetails /></aside>;
  const counts = problemCounts(problems);
  return (
    <aside className="pl-right" aria-label="Details">
      <section aria-label="Pipeline">
        <h3>Pipeline</h3>
        <PipelineFields />
        <p className="muted small">{pipelineCounts(config)}</p>
      </section>
      <section aria-label="Validation">
        <h3>Validation {counts.error > 0 && <span className="badge error">{counts.error}</span>} {counts.warn > 0 && <span className="badge warn">{counts.warn}</span>}</h3>
        <ProblemList problems={problems} onSelect={selectProblem} />
      </section>
      <section aria-label="Drop behaviour">
        <h3>Drop behaviour</h3>
        <dl className="pl-legend">{LEGEND.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
        <p className="muted small">Double-click a component or a slot for properties.</p>
      </section>
    </aside>
  );
}

function PipelineFields() {
  const config = usePipelineEditor(s => s.config)!;
  const apply = usePipelineEditor(s => s.apply);
  return (
    <div className="stack">
      <Field label="Name" hint="Unique; Export writes <name>.pspp."><TextInput value={config.name} onChange={name => apply(c => ({ ...c, name }), "pipeline:name")} /></Field>
      <Field label="Description"><TextArea rows={2} value={config.description ?? ""} onChange={d => apply(c => { const { description: _old, ...rest } = c; return d ? { ...rest, description: d } : rest; }, "pipeline:description")} /></Field>
    </div>
  );
}

function ComponentDetails({ id }: { id: string }) {
  const config = usePipelineEditor(s => s.config)!;
  const problems = usePipelineEditor(s => s.problems).filter(p => p.target?.componentId === id);
  const store = usePipelineEditor.getState;
  const c = config.components.find(x => x.id === id)!;
  const info = kindInfo(c.kind);
  const items: [string, string][] = Object.entries(c).filter(([k]) => !["id", "kind", "role", "filters", "script", "tools"].includes(k)).map(([k, v]) => [k, typeof v === "string" ? v : JSON.stringify(v)]);
  return (
    <section aria-label={`${info?.label ?? c.kind} ${c.id}`}>
      <h3>{info?.label ?? c.kind}</h3>
      <div className="pl-detail-id">{c.id}</div>
      <p className="muted small">{info?.description ?? "An extension kind this studio does not know; edited as key/value pairs."}</p>
      <KeyValue items={[["Role", `${c.role}${c.side ? ` · ${c.side}` : ""}`], ["Attached", attachment(config, c)], ...items]} />
      <div className="row">
        <button type="button" className="primary" onClick={() => store().openDialog({ kind: "component", componentId: id })}>Properties…</button>
        <button type="button" className="danger" onClick={() => { store().apply(cfg => removeComponent(cfg, id)); store().setFree(id, null); store().select({}); }}>Delete</button>
        <button type="button" onClick={() => store().select({})}>Done</button>
      </div>
      <h3>Problems</h3>
      <ProblemList problems={problems} />
    </section>
  );
}

function FilterDetails({ selection }: { selection: Selection }) {
  const config = usePipelineEditor(s => s.config)!;
  const store = usePipelineEditor.getState;
  const f = selection.filter!;
  const proxy = config.components.find(c => c.id === f.componentId);
  const spec = filtersOf(proxy, f.side)[f.index];
  if (spec === undefined) return <p className="muted">That slot no longer exists.</p>;
  const kind = filterKind(spec), info = filterInfo(kind);
  const options = filterOptionsOf(spec);
  return (
    <section aria-label={`Filter ${info?.label ?? kind}`}>
      <h3>{info?.label ?? kind}</h3>
      <div className="pl-detail-id">{f.side} slot {f.index + 1} of {f.componentId}</div>
      <p className="small">{info?.description ?? "Unknown filter kind; runs skip it."}</p>
      {info && <p className="muted small">{info.reference}</p>}
      {Object.keys(options).length > 0 && <KeyValue items={Object.entries(options).map(([k, v]) => [k, String(v)])} />}
      <div className="row">
        <button type="button" className="primary" onClick={() => store().openDialog({ kind: "filter", ...f })}>Properties…</button>
        <button type="button" className="danger" onClick={() => { store().apply(cfg => removeFilter(cfg, f.componentId, f.side, f.index)); store().select({}); }}>Remove</button>
      </div>
    </section>
  );
}

function PspDetails() {
  const config = usePipelineEditor(s => s.config)!;
  const env = usePipelineEditor(s => s.env);
  const store = usePipelineEditor.getState;
  const psp = pspSummaryOf(env);
  return (
    <section aria-label="PSP Document">
      <h3>PSP Document</h3>
      {config.psp ? <KeyValue items={[["Pointer", config.psp.document], ["Resolves to", psp?.path ?? (env.psp?.status === "unresolved" ? env.psp.reason : "")], ["Signing", config.psp.signOnRetrieval ? `on retrieval · ${config.psp.signOnRetrieval}` : "as written"], ["Sections", psp ? String(psp.sections.length) : ""], ["Covenants", psp?.covenants.join(", ") ?? ""]]} />
        : <p className="muted small">No PSP: the ring runs without a bootstrap document. psp-verify has nothing to check, agents-registration names every backend tool and no covenants are in context.</p>}
      <div className="row"><button type="button" className="primary" onClick={() => store().openDialog({ kind: "psp" })}>{config.psp ? "Properties…" : "Reference a PSP…"}</button></div>
    </section>
  );
}
