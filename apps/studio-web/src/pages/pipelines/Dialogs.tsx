// SPDX-License-Identifier: Apache-2.0
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Controller, useForm, type Control } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  conflicts, FILTER_KINDS, filterInfo, filterKind, filterOptionsOf, filtersOf, inferProvider, kindInfo, pspRefSchema, registrationsFor, renameComponent,
  setFilter, setPsp, sinkCapabilities, TAP_CAPABILITIES, toolDeclarations, updateComponent, COMPONENT_ID, ACTING_CAPABILITIES,
  type Component, type FilterSpec, type PipelineConfig, type PspRef, type Side
} from "@psp-cdl/studio-core";
import { Field, FormGrid, JsonInput, TokenInput } from "../../components/fields";
import { Modal } from "../../components/Modal";
import { KeyValue, Notice, Tabs } from "../../components/Page";
import { useStudio } from "../../data";
import { api } from "../../lib/api";
import { errorText, formatTime } from "../../lib/format";
import { navigate } from "../../router";
import { pspHref } from "../scenarios/ScenarioForms";
import { pspSummaryOf, usePipelineEditor, type DialogTarget } from "../../pipeline/store";

type JsonProperty = { type?: string; enum?: unknown[]; title?: string; description?: string; items?: { type?: string }; anyOf?: JsonProperty[] };
const jsonProps = (schema: z.ZodObject): { properties: Record<string, JsonProperty>; required: string[] } => {
  const out = z.toJSONSchema(schema, { io: "input", unrepresentable: "any" }) as { properties?: Record<string, JsonProperty>; required?: string[] };
  return { properties: out.properties ?? {}, required: out.required ?? [] };
};
const fieldKind = (p: JsonProperty): "enum" | "string" | "number" | "boolean" | "tokens" | "json" =>
  p.enum ? "enum" : p.type === "string" ? "string" : p.type === "number" || p.type === "integer" ? "number" : p.type === "boolean" ? "boolean" : p.type === "array" && p.items?.type === "string" ? "tokens" : "json";

/** Form fields generated from a kind's schema. Blank means "not set". */
function SchemaFields({ schema, keys, control, labels = {}, lists = {} }: { schema: z.ZodObject; keys: readonly string[]; control: Control<Record<string, unknown>>; labels?: Record<string, string>; /** Datalist ids with suggestions, per key. */ lists?: Record<string, string> }) {
  const { properties, required } = useMemo(() => jsonProps(schema), [schema]);
  return (
    <FormGrid>
      {keys.filter(k => properties[k]).map(key => {
        const p = properties[key]!, kind = fieldKind(p), label = labels[key] ?? p.title ?? key;
        return (
          <Controller key={key} name={key} control={control} render={({ field, fieldState }) => (
            <Field label={label} hint={p.description} error={fieldState.error?.message ?? null} wide={kind === "json"}>
              {kind === "enum" ? (
                <select id={undefined} aria-label={label} value={field.value === undefined ? "" : String(field.value)} onChange={e => field.onChange(e.target.value === "" ? undefined : e.target.value)}>
                  {!required.includes(key) && <option value="">(not set)</option>}
                  {p.enum!.map(v => <option key={String(v)} value={String(v)}>{String(v)}</option>)}
                </select>
              ) : kind === "boolean" ? (
                <input type="checkbox" aria-label={label} checked={field.value === true} onChange={e => field.onChange(e.target.checked)} />
              ) : kind === "number" ? (
                <input type="number" aria-label={label} step="any" value={field.value === undefined ? "" : String(field.value)} onChange={e => field.onChange(e.target.value === "" ? undefined : Number(e.target.value))} />
              ) : kind === "tokens" ? (
                <TokenInput ariaLabel={label} value={(field.value as string[] | undefined) ?? []} onChange={v => field.onChange(v.length ? v : undefined)} />
              ) : kind === "json" ? (
                <JsonInput ariaLabel={label} rows={6} value={field.value ?? null} onChange={v => field.onChange(v === null ? undefined : v)} />
              ) : (
                <input type="text" aria-label={label} autoComplete="off" list={lists[key]} value={field.value === undefined ? "" : String(field.value)} onChange={e => field.onChange(e.target.value === "" ? undefined : e.target.value)} />
              )}
            </Field>
          )} />
        );
      })}
    </FormGrid>
  );
}

export function Dialogs() {
  const dialog = usePipelineEditor(s => s.dialog);
  const config = usePipelineEditor(s => s.config);
  if (!dialog || !config) return null;
  const close = () => usePipelineEditor.getState().openDialog(null);
  if (dialog.kind === "psp") return <PspDialog initialTab={dialog.tab ?? "source"} onClose={close} />;
  if (dialog.kind === "filter") return <FilterDialog target={dialog} onClose={close} />;
  if (dialog.kind === "component" && config.components.some(c => c.id === dialog.componentId)) return <ComponentDialog key={dialog.componentId} id={dialog.componentId} initialTab={dialog.tab} onClose={close} />;
  return null;
}

const footerNote = (config: PipelineConfig, c: Component) => <span className="modal-note muted small">writes <code>components[{config.components.indexOf(c)}]</code> ({c.id}) in {config.name}</span>;

function ComponentDialog({ id, initialTab, onClose }: { id: string; initialTab?: string | undefined; onClose(): void }) {
  const config = usePipelineEditor(s => s.config)!;
  const store = usePipelineEditor.getState;
  const c = config.components.find(x => x.id === id)!;
  const info = kindInfo(c.kind);
  // Filters are edited by the list editors, so the form schema leaves them out.
  const schema = useMemo(() => {
    const shape: Record<string, z.ZodType> = { ...(info?.schema.shape ?? {}) };
    delete shape.filters;
    return z.object({ id: z.string().regex(COMPONENT_ID, "Use a letter, then letters, digits, dot, dash or underscore."), ...shape });
  }, [info]);
  const keys = Object.keys(info?.schema.shape ?? {});
  const defaults = useMemo(() => Object.fromEntries([["id", c.id], ...keys.filter(k => k !== "filters" && c[k] !== undefined).map(k => [k, structuredClone(c[k])])]), [c]); // eslint-disable-line react-hooks/exhaustive-deps
  const form = useForm<Record<string, unknown>>({ resolver: zodResolver(schema) as never, defaultValues: defaults });
  const [filters, setFilters] = useState<{ request: FilterSpec[]; response: FilterSpec[] }>({ request: [...filtersOf(c, "request")] as FilterSpec[], response: [...filtersOf(c, "response")] as FilterSpec[] });
  const [generic, setGeneric] = useState<Record<string, unknown>>(() => Object.fromEntries(Object.entries(c).filter(([k]) => !["id", "kind", "role"].includes(k))));
  const [error, setError] = useState<string | null>(null);
  const tabs = tabsFor(c);
  const [tab, setTab] = useState(initialTab && tabs.some(t => t.id === initialTab) ? initialTab : tabs[0]!.id);
  const values = form.watch();

  const apply = form.handleSubmit(v => {
    try {
      let next = config;
      if (info) {
        const patch: Record<string, unknown> = {};
        for (const k of keys) if (k !== "filters") patch[k] = v[k];
        if (c.kind === "llmproxy") patch.filters = filters;
        next = updateComponent(next, id, patch);
      } else {
        const patch: Record<string, unknown> = Object.fromEntries(Object.keys(c).filter(k => !["id", "kind", "role"].includes(k)).map(k => [k, undefined]));
        next = updateComponent(next, id, { ...patch, ...generic });
      }
      if (v.id !== id) next = renameComponent(next, id, String(v.id));
      store().apply(next);
      if (v.id !== id) store().select({ componentId: String(v.id) });
      onClose();
    } catch (e) { setError(errorText(e)); }
  }, () => setError("Fix the highlighted fields first."));

  const fields = (k: readonly string[], labels?: Record<string, string>) => <SchemaFields schema={schema} keys={k} control={form.control} {...(labels ? { labels } : {})} />;
  let body: ReactNode;
  if (!info) body = <><Notice kind="info">{c.kind} is an extension kind this studio does not know. Its properties are edited as JSON and runs ignore it.</Notice>{fields(["id"])}<Field label="Properties" wide><JsonInput ariaLabel="Properties" rows={10} value={generic} onChange={v => setGeneric(v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {})} /></Field></>;
  else if (c.kind === "llmproxy") body = tab === "general" ? <>{fields(["id", "lockdown"])}<VectorStorePicker control={form.control} config={config} /></>
    : tab === "request" || tab === "response" ? <FilterListEditor side={tab} list={filters[tab]} onChange={list => setFilters(f => ({ ...f, [tab]: list }))} />
    : <Telemetry proxy={c} />;
  else if (c.kind === "model") body = <>{fields(["id", "model", "provider", ...(values.provider === "mock" || inferProvider(String(values.model ?? ""), values.provider) === "mock" ? ["script"] : [])])}<ModelRegistrations /></>;
  else if (c.kind === "initiator") body = tab === "trigger" ? fields(["id", "trigger", ...triggerKeys(String(values.trigger))]) : <>{fields(["reply", ...(values.trigger === "file" && values.reply !== "none" ? ["output"] : [])])}<ReplyNotes initiator={{ ...c, ...values } as Component} /></>;
  else if (c.kind === "mcpproxy") body = tab === "backend" ? <>{fields(["id", "backend", "serverInfo", "server", "auth"], { serverInfo: "Server info (name and version)" })}<ToolDeclarations proxy={c} control={form.control} /></>
    : tab === "drift" ? <>{fields(["drift"])}<DriftPanel proxy={c} /></>
    : <CovenantNotes proxy={c} />;
  else if (c.kind === "vector-store") body = <>{fields(["id", ...keys])}<VectorStatusPanel storeId={c.id} /></>;
  else body = fields(["id", ...keys]);

  return (
    <Modal wide title={`${info?.label ?? c.kind} · ${c.id}`} onClose={onClose}
      footer={<>{footerNote(config, c)}<button type="button" onClick={onClose}>Cancel</button><button type="button" className="primary" onClick={() => void apply()}>Apply</button></>}>
      {error && <Notice kind="error">{error}</Notice>}
      {tabs.length > 1 && <Tabs label={`${info?.label ?? c.kind} properties`} tabs={tabs} active={tab} onSelect={setTab} />}
      <div className="pl-dialog-body">{body}</div>
    </Modal>
  );
}

function tabsFor(c: Component): { id: string; label: string }[] {
  switch (c.kind) {
    case "llmproxy": return [{ id: "general", label: "General" }, { id: "request", label: "Request filters" }, { id: "response", label: "Response filters" }, { id: "telemetry", label: "Telemetry" }];
    case "initiator": return [{ id: "trigger", label: "Trigger" }, { id: "reply", label: "Reply" }];
    case "mcpproxy": return [{ id: "backend", label: "Backend" }, { id: "drift", label: "Drift" }, { id: "covenants", label: "Covenants" }];
    default: return [{ id: "general", label: "General" }];
  }
}
const triggerKeys = (trigger: string): string[] => ({ file: ["watch", "onDone"], email: ["mailbox"], webhook: ["route", "auth"], schedule: ["cron", "prompt"] } as Record<string, string[]>)[trigger] ?? [];

function VectorStorePicker({ control, config }: { control: Control<Record<string, unknown>>; config: PipelineConfig }) {
  const stores = config.components.filter(c => c.kind === "vector-store");
  return (
    <Controller name="vectorStore" control={control} render={({ field }) => (
      <Field label="Vector store" hint="Read by Exfil Guard. Without one, Exfil Guard runs the lexical tier only.">
        <select aria-label="Vector store" value={String(field.value ?? "")} onChange={e => field.onChange(e.target.value || undefined)}>
          <option value="">(none)</option>
          {stores.map(s => <option key={s.id} value={s.id}>{s.id}</option>)}
          {typeof field.value === "string" && field.value && !stores.some(s => s.id === field.value) && <option value={field.value}>{field.value} (missing)</option>}
        </select>
      </Field>
    )} />
  );
}

/** An ordered filter list: execution order, drag or arrows to reorder, options inline. */
function FilterListEditor({ side, list, onChange }: { side: Side; list: FilterSpec[]; onChange(list: FilterSpec[]): void }) {
  const [adding, setAdding] = useState(FILTER_KINDS.find(f => f.side === side)!.kind);
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const move = (from: number, to: number) => { if (to < 0 || to >= list.length) return; const next = [...list]; const [x] = next.splice(from, 1); next.splice(to, 0, x!); onChange(next); };
  const setOptions = (i: number, options: Record<string, unknown>) => {
    const kind = filterKind(list[i]);
    const clean = Object.fromEntries(Object.entries(options).filter(([, v]) => v !== undefined && v !== ""));
    onChange(list.map((s, j) => j === i ? (Object.keys(clean).length ? { kind, ...clean } : kind) : s));
  };
  return (
    <div className="stack">
      <p className="muted small">Slots run in this order. {side === "response" ? "The reference loop runs its release phase (Covenant Gate) before authorizeFinal (Exfil Guard, Data-use check), whatever the slot order." : ""}</p>
      <ol className="pl-filter-list" aria-label={`${side} filters`}>
        {list.map((spec, i) => {
          const kind = filterKind(spec), info = filterInfo(kind);
          const options = filterOptionsOf(spec);
          return (
            <li key={`${i}:${kind}`} draggable onDragStart={() => setDragFrom(i)} onDragOver={e => e.preventDefault()} onDrop={() => { if (dragFrom !== null) move(dragFrom, i); setDragFrom(null); }}>
              <div className="row">
                <span className="pl-slot-n">{i + 1}</span><strong>{info?.label ?? kind}</strong>
                {info && !info.supported && <span className="badge warn">unsupported</span>}
                {info && info.side !== side && <span className="badge error">{info.side} filter</span>}
                <span className="spacer" />
                <button type="button" aria-label={`Move ${kind} up`} disabled={i === 0} onClick={() => move(i, i - 1)}>↑</button>
                <button type="button" aria-label={`Move ${kind} down`} disabled={i === list.length - 1} onClick={() => move(i, i + 1)}>↓</button>
                <button type="button" className="danger" aria-label={`Remove ${kind}`} onClick={() => onChange(list.filter((_, j) => j !== i))}>Remove</button>
              </div>
              {info && Object.keys(info.schema.shape).length > 0 && <FilterOptions kind={kind} value={options} onChange={o => setOptions(i, o)} />}
            </li>
          );
        })}
      </ol>
      <div className="row">
        <select aria-label={`Add a ${side} filter`} value={adding} onChange={e => setAdding(e.target.value)}>
          {FILTER_KINDS.filter(f => f.side === side).map(f => <option key={f.kind} value={f.kind}>{f.label}</option>)}
        </select>
        <button type="button" onClick={() => onChange([...list, adding])}>Add</button>
      </div>
    </div>
  );
}

/** A filter's own options, from its schema. */
function FilterOptions({ kind, value, onChange }: { kind: string; value: Record<string, unknown>; onChange(value: Record<string, unknown>): void }) {
  const info = filterInfo(kind)!;
  const { properties } = jsonProps(info.schema);
  return (
    <FormGrid>
      {Object.entries(properties).map(([key, p]) => (
        <Field key={key} label={p.title ?? key} hint={p.description}>
          {p.enum ? (
            <select aria-label={`${info.label} ${p.title ?? key}`} value={String(value[key] ?? "")} onChange={e => onChange({ ...value, [key]: e.target.value || undefined })}>
              <option value="">(default)</option>{p.enum.map(v => <option key={String(v)} value={String(v)}>{String(v)}</option>)}
            </select>
          ) : (
            <input type="number" step="any" aria-label={`${info.label} ${p.title ?? key}`} value={value[key] === undefined ? "" : String(value[key])} onChange={e => onChange({ ...value, [key]: e.target.value === "" ? undefined : Number(e.target.value) })} />
          )}
        </Field>
      ))}
    </FormGrid>
  );
}

function FilterDialog({ target, onClose }: { target: Extract<DialogTarget, { kind: "filter" }>; onClose(): void }) {
  const config = usePipelineEditor(s => s.config)!;
  const spec = filtersOf(config.components.find(c => c.id === target.componentId), target.side)[target.index];
  const [options, setOptions] = useState<Record<string, unknown>>(() => filterOptionsOf(spec));
  const [error, setError] = useState<string | null>(null);
  if (spec === undefined) return null;
  const kind = filterKind(spec), info = filterInfo(kind);
  const apply = () => {
    const clean = Object.fromEntries(Object.entries(options).filter(([, v]) => v !== undefined && v !== ""));
    if (info) { const r = info.schema.safeParse(clean); if (!r.success) { setError(r.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join(" ")); return; } }
    usePipelineEditor.getState().apply(c => setFilter(c, target.componentId, target.side, target.index, Object.keys(clean).length ? { kind, ...clean } : kind));
    onClose();
  };
  return (
    <Modal title={`${info?.label ?? kind} · ${target.side} slot ${target.index + 1}`} onClose={onClose}
      footer={<><span className="modal-note muted small">writes <code>{target.componentId}.filters.{target.side}[{target.index}]</code></span><button type="button" onClick={onClose}>Cancel</button><button type="button" className="primary" onClick={apply}>Apply</button></>}>
      {error && <Notice kind="error">{error}</Notice>}
      <p>{info?.description ?? "Unknown filter kind; runs skip it."}</p>
      {info && <p className="muted small">{info.reference}</p>}
      {info && Object.keys(info.schema.shape).length > 0 ? <FilterOptions kind={kind} value={options} onChange={setOptions} />
        : !info ? <Field label="Options"><JsonInput ariaLabel="Options" value={options} onChange={v => setOptions((v ?? {}) as Record<string, unknown>)} /></Field> : <p className="muted small">This filter has no options.</p>}
    </Modal>
  );
}

function Telemetry({ proxy }: { proxy: Component }) {
  const config = usePipelineEditor(s => s.config)!;
  const env = usePipelineEditor(s => s.env);
  const psp = pspSummaryOf(env);
  const taps = config.components.filter(c => (c.kind === "logger" || c.kind === "otel") && typeof c.taps === "string" && c.taps.startsWith(proxy.id + "."));
  if (!taps.length) return <p className="muted">No auxiliary taps are attached. Drop a Logger or OTel near the response half.</p>;
  return <KeyValue items={taps.map(t => {
    const term = psp?.covenants.find(cov => conflicts(cov, "covenant", TAP_CAPABILITIES[t.kind] ?? []));
    return [t.id, `${kindInfo(t.kind)?.label} · ${String(t.taps)} · ${t.kind === "otel" ? "unsupported (no exporter)" : term ? `redacted while ${term} is in context` : "records written in full"}`];
  })} />;
}

function ModelRegistrations() {
  const config = usePipelineEditor(s => s.config)!;
  const env = usePipelineEditor(s => s.env);
  const run = usePipelineEditor(s => s.run);
  const preview = run.session?.registrations ?? registrationsFor(config, pspSummaryOf(env), env.catalogs ?? {});
  return (
    <section className="pl-group" aria-label="Registrations">
      <h4>Registrations for {preview.node ? `node ${preview.node}` : "this pipeline"} {run.session ? "(this session)" : "(preview)"}</h4>
      <KeyValue items={[
        ["Allowed", preview.allowed.join(", ")],
        ["Withheld by node", preview.withheldByNode.join(", ")],
        ["Withheld by covenant", preview.withheldByCovenant.map(w => `${w.tool} (${w.covenant})`).join(", ")],
        ["Not read-only", preview.withheldByMode.join(", ")],
        ...(preview.unknownBackends.length ? [["Unknown until first run", preview.unknownBackends.join(", ")] as [string, string]] : [])
      ]} />
    </section>
  );
}

function ReplyNotes({ initiator }: { initiator: Component }) {
  const config = usePipelineEditor(s => s.config)!;
  const env = usePipelineEditor(s => s.env);
  const psp = pspSummaryOf(env);
  if (initiator.reply === "none") {
    const acting = config.components.filter(c => c.kind === "mcpproxy").flatMap(c => env.catalogs?.[c.id] ? toolDeclarations(c, env.catalogs[c.id]!) : []).filter(t => t.capabilities.some(cap => ACTING_CAPABILITIES.has(cap)));
    return <p className="muted small">The outcome is an MCP tool's doing; the ring is open and the reply is recorded, not delivered. Registered tools that can act: {acting.length ? acting.map(t => `${t.label}${t.readOnly ? "" : " (not read-only: the reference gate cannot dispatch it)"}`).join(", ") : "none known"}.</p>;
  }
  const caps = sinkCapabilities(initiator);
  const blocking = (psp?.covenants ?? []).filter(t => conflicts(t, "covenant", caps));
  return <p className="muted small">Sink capabilities: {caps.join(", ") || "none"}. {blocking.length ? `Covenants in the referenced PSP that would withhold replies on this channel: ${blocking.join(", ")}.` : "No covenant in the referenced PSP withholds replies on this channel."}</p>;
}

function ToolDeclarations({ proxy, control }: { proxy: Component; control: Control<Record<string, unknown>> }) {
  const env = usePipelineEditor(s => s.env);
  const catalog = env.catalogs?.[proxy.id];
  return (
    <section className="pl-group" aria-label="Tools discovered">
      <h4>Tools discovered {catalog ? `· baseline ${formatTime(catalog.capturedAt)}` : ""}</h4>
      {!catalog ? <p className="muted small">Unknown until the first run captures the backend's catalog.</p> : (
        <table className="pl-table"><thead><tr><th>Tool</th><th>Read-only hint</th><th>Declared capabilities</th></tr></thead>
          <tbody>{catalog.tools.map(t => <tr key={t.name}><td><code>{t.name}</code></td><td>{t.readOnly ? "yes" : "no"}</td><td>{t.capabilities.join(", ")}</td></tr>)}</tbody></table>
      )}
      <Controller name="tools" control={control} render={({ field }) => (
        <Field label="Host declarations" hint="Per tool: readOnly admission and extra CDL capabilities, for example {&quot;send_mail&quot;: {&quot;capabilities&quot;: [&quot;can-send-email&quot;]}}. These describe tools; they never filter them." wide>
          <JsonInput ariaLabel="Host declarations" rows={5} value={field.value ?? {}} onChange={v => field.onChange(v && typeof v === "object" && Object.keys(v as object).length ? v : undefined)} />
        </Field>
      )} />
    </section>
  );
}

function DriftPanel({ proxy }: { proxy: Component }) {
  const row = usePipelineEditor(s => s.row)!;
  const report = usePipelineEditor(s => s.drift[proxy.id]);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = (work: () => Promise<void>) => { setBusy(true); setError(null); work().catch(e => setError(errorText(e))).finally(() => setBusy(false)); };
  return (
    <section className="pl-group" aria-label="Drift">
      {error && <Notice kind="error">{error}</Notice>}
      <KeyValue items={[
        ["Status", report?.status ?? "unknown"],
        ["Baseline hash", report?.baseline ? report.baseline.digest.slice(0, 16) + "…" : "none yet"],
        ["Captured", report?.baseline ? formatTime(report.baseline.capturedAt) : ""],
        ["Last check", formatTime(report?.lastCheckAt ?? null)],
        ["Detail", report?.detail ?? ""]
      ]} />
      <p className="muted small">The baseline is MCPProxy's runtime state, not configuration. The first run captures it; a re-baseline is explicit and logged.</p>
      <div className="row">
        <button type="button" disabled={busy} onClick={() => run(async () => { usePipelineEditor.getState().setDrift(await api.drift(row.id, proxy.id, true)); })}>Check now</button>
        <input type="text" aria-label="Re-baseline note" placeholder="Why (logged)" value={note} onChange={e => setNote(e.target.value)} />
        <button type="button" disabled={busy || !note.trim()} onClick={() => run(async () => { if (window.confirm(`Re-baseline ${proxy.id} against its backend's current catalog?`)) usePipelineEditor.getState().setDrift(await api.rebaseline(row.id, proxy.id, note.trim())); })}>Re-baseline</button>
      </div>
      {report?.log.length ? <table className="pl-table"><thead><tr><th>When</th><th>Action</th><th>Note</th></tr></thead><tbody>{report.log.map(l => <tr key={l.seq}><td>{formatTime(l.at)}</td><td>{l.action}</td><td>{l.note ?? ""}</td></tr>)}</tbody></table> : null}
    </section>
  );
}

function CovenantNotes({ proxy }: { proxy: Component }) {
  const env = usePipelineEditor(s => s.env);
  const psp = pspSummaryOf(env);
  return (
    <div className="stack">
      <Notice kind="info">The reference MCPProxy neither injects covenants into backend calls nor augments results. Covenants act through LLMProxy: covenant pruning withholds registrations, and the dispatch gate denies a call whose tool capabilities conflict (POLICY_DENIED). This proxy has no allowlist; that is LLMProxy's job.</Notice>
      <KeyValue items={[["Covenants in context", psp?.covenants.join(", ") ?? "none (no PSP)"], ["Server name", String(proxy.server ?? "from the backend URL")]]} />
    </div>
  );
}

function VectorStatusPanel({ storeId }: { storeId: string }) {
  const status = usePipelineEditor(s => s.vectors[storeId]);
  if (!status) return <p className="muted small">Status loads after the pipeline is saved.</p>;
  return (
    <section className="pl-group" aria-label="Store status">
      <h4>Status (read-only)</h4>
      <KeyValue items={[["Exists", status.exists ? "yes" : "not yet"], ["Embedding", `${status.embedding}${status.available ? "" : " (not available on this server: lexical tier only)"}`], ["Sections", String(status.sections)], ["Chunks", String(status.chunks)],
        ...status.applications.map(a => [`${a.application} · ${a.sectionType}`, `${a.sections} sections · ${a.chunks} chunks`] as [string, string])]} />
      <p className="muted small">LLMProxy registers the verified SYSTEM text when a session starts. This editor never writes to the store.</p>
    </section>
  );
}

/** The PSP Document card's reference dialog: pointer and signing, plus a read-only view of the document's sections. */
function PspDialog({ initialTab, onClose }: { initialTab: string; onClose(): void }) {
  const config = usePipelineEditor(s => s.config)!;
  const env = usePipelineEditor(s => s.env);
  const { files } = useStudio();
  const [tab, setTab] = useState(initialTab);
  const form = useForm<Record<string, unknown>>({ resolver: zodResolver(pspRefSchema) as never, defaultValues: { document: config.psp?.document ?? "env:PSP_DOC", ...(config.psp?.signOnRetrieval ? { signOnRetrieval: config.psp.signOnRetrieval } : { signOnRetrieval: "ed25519" }) } });
  const pointer = String(form.watch("document") ?? "");
  const [resolution, setResolution] = useState(env.psp ?? null);
  useEffect(() => {
    if (!pointer) return;
    let cancelled = false;
    const timer = setTimeout(() => api.pspSummary(pointer).then(r => { if (!cancelled) setResolution(r); }).catch(() => {}), 250);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [pointer]);
  const summary = resolution?.status === "resolved" ? resolution.summary : null;
  const proxy = config.components.find(c => c.kind === "llmproxy");
  const guarded = !!proxy && filtersOf(proxy, "response").some(s => filterKind(s) === "exfil-guard");
  const apply = form.handleSubmit(v => { usePipelineEditor.getState().apply(c => setPsp(c, { document: String(v.document), ...(v.signOnRetrieval ? { signOnRetrieval: v.signOnRetrieval } : {}) } as PspRef)); onClose(); });
  const clear = () => { const store = usePipelineEditor.getState(); store.apply(c => setPsp(c, null)); store.select({}); onClose(); };
  const suggestions = ["env:PSP_DOC", ...files.filter(f => /\.pspx?$/i.test(f.path)).map(f => f.path), ...files.filter(f => /^prompts\/[^/]+\.md$/.test(f.path)).map(f => `prompt:${f.path.slice(8, -3)}`)];
  return (
    <Modal wide title="PSP Document" onClose={onClose}
      footer={<>
        <span className="modal-note muted small">writes <code>psp</code> in {config.name} · the document itself is never edited here</span>
        {config.psp && <button type="button" className="danger" onClick={clear}>Clear</button>}
        <button type="button" disabled={!summary || summary.format === "prompt"} onClick={() => { onClose(); navigate(pspHref(summary!.path)); }}>Open in PSP editor</button>
        <button type="button" onClick={onClose}>Cancel</button>
        <button type="button" className="primary" onClick={() => void apply()}>Apply</button>
      </>}>
      <Tabs label="PSP Document" tabs={[{ id: "source", label: "Source" }, { id: "sections", label: "Sections" }]} active={tab} onSelect={setTab} />
      {tab === "source" ? (
        <div className="stack">
          <datalist id="psp-pointers">{suggestions.map(s => <option key={s} value={s} />)}</datalist>
          <SchemaFields schema={pspRefSchema} keys={["document", "signOnRetrieval"]} control={form.control} lists={{ document: "psp-pointers" }} />
          <KeyValue items={[
            ["Resolves to", summary ? `${summary.path} (${summary.format})` : resolution?.status === "unresolved" ? resolution.reason : "…"],
            ["Session binding", "LLMProxy resolves the document once per session at bootstrap, signs it with the session binding (tenant, session, node, policy and provider revisions) and verifies it on every step. Read-only."]
          ]} />
          {!config.psp && <p className="muted small">This pipeline runs without a PSP until you apply a reference.</p>}
        </div>
      ) : !summary ? <p className="muted">{resolution?.status === "unresolved" ? resolution.reason : "Resolving…"}</p> : (
        <div className="stack">
          {!summary.parses && <Notice kind="error">The document does not parse: {summary.error}</Notice>}
          <table className="pl-table" aria-label="Sections">
            <thead><tr><th>Section</th><th>Signature</th><th>Expires</th><th>Covenants</th><th>Exfiltration</th></tr></thead>
            <tbody>{summary.sections.map((s, i) => (
              <tr key={i}>
                <td>{s.type.toUpperCase()} {s.ref && <code>{s.ref}</code>}</td>
                <td>{s.signature}{s.algorithm ? ` · ${s.algorithm}` : ""}</td>
                <td>{s.expires ? formatTime(s.expires) : ""}</td>
                <td>{[...s.covenants, ...s.classes].join(", ")}</td>
                <td>{s.type === "system" && guarded ? "registered at bootstrap" : "not registered"}</td>
              </tr>
            ))}</tbody>
          </table>
          <p className="muted small">Signatures, covenants (<code>x-cdl-covenants</code> on JSON CONTEXT payloads) and the text belong to the PSP editor. PSP has no Prevent Exfilt attribute: LLMProxy registers the verified SYSTEM text for Exfil Guard when a session starts (PSP-EXFIL-0.1).</p>
        </div>
      )}
    </Modal>
  );
}

