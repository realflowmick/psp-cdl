// SPDX-License-Identifier: Apache-2.0
/**
 * Configuration edits. Every canvas gesture, dialog and quick fix is one of these pure functions, so a
 * graph edit changes exactly the keys it means to and the saved JSON diff stays minimal.
 */
import { kindInfo } from "./kinds.js";
import { onSide, primaryProxy, terminals } from "./topology.js";
import type { Component, FilterSpec, PipelineConfig, PipelineEdit, PspRef, Side } from "./types.js";

export class PipelineEditError extends Error {
  constructor(public readonly code: string, message: string) { super(message); this.name = "PipelineEditError"; }
}
const fail = (code: string, message: string): never => { throw new PipelineEditError(code, message); };

const ID_PREFIX: Record<string, string> = { "vector-store": "vectors", logger: "log" };
/** `<prefix>_<n>` with the first free n, for example `mcpproxy_2` or `log_1`. */
export function newComponentId(config: PipelineConfig, kind: string): string {
  const prefix = ID_PREFIX[kind] ?? kind.replace(/[^A-Za-z0-9]/g, "_");
  const ids = new Set(config.components.map(c => c.id));
  for (let n = 1; ; n++) if (!ids.has(`${prefix}_${n}`)) return `${prefix}_${n}`;
}
/** A new component of a known (or extension) kind with its defaults. */
export function createComponent(config: PipelineConfig, kind: string, extra: Record<string, unknown> = {}): Component {
  const info = kindInfo(kind);
  return { id: newComponentId(config, kind), kind, role: info?.role ?? "aux", ...(info?.defaults() ?? {}), ...extra } as Component;
}

/** The configuration a new pipeline starts with: Initiator (chat, with a sink), LLMProxy and Model, no PSP. */
export function newPipeline(name: string): PipelineConfig {
  return {
    name, psp: null,
    components: [
      { id: "llmproxy_1", kind: "llmproxy", role: "ring", filters: { request: [], response: [] } },
      { id: "model_1", kind: "model", role: "terminal", model: "claude-sonnet-4-6" },
      { id: "initiator_1", kind: "initiator", role: "terminal", trigger: "chat" }
    ]
  };
}

const at = (config: PipelineConfig, id: string): number => {
  const i = config.components.findIndex(c => c.id === id);
  return i < 0 ? fail("NOT_FOUND", `No component ${id}.`) : i;
};
const replace = (config: PipelineConfig, i: number, next: Component): PipelineConfig => ({ ...config, components: config.components.map((c, j) => j === i ? next : c) });

/** Sets keys on one component; `undefined` removes a key. Unchanged keys keep their order. */
export function updateComponent(config: PipelineConfig, id: string, patch: Record<string, unknown>): PipelineConfig {
  const i = at(config, id), current = config.components[i]!;
  const next: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(current)) if (!(k in patch)) next[k] = v; else if (patch[k] !== undefined) next[k] = patch[k];
  for (const [k, v] of Object.entries(patch)) if (!(k in current) && v !== undefined) next[k] = v;
  return replace(config, i, next as Component);
}

/** Renames a component and every reference to it (vectorStore, caller, taps). */
export function renameComponent(config: PipelineConfig, from: string, to: string): PipelineConfig {
  if (from === to) return config;
  if (config.components.some(c => c.id === to)) fail("DUPLICATE_ID", `${to} is already used.`);
  return {
    ...config,
    components: config.components.map(c => {
      const next: Component = { ...c };
      if (c.id === from) next.id = to;
      if (c.vectorStore === from) next.vectorStore = to;
      if (c.caller === from) next.caller = to;
      if (typeof c.taps === "string" && c.taps.startsWith(from + ".")) next.taps = to + c.taps.slice(from.length);
      return next;
    })
  };
}

/** Removes a component; LLMProxy goes with both halves. References to it are cleared where they would dangle silently. */
export function removeComponent(config: PipelineConfig, id: string): PipelineConfig {
  at(config, id);
  return {
    ...config,
    components: config.components.filter(c => c.id !== id).map(c => {
      if (c.vectorStore !== id) return c;
      const { vectorStore: _drop, ...rest } = c;
      return rest as Component;
    })
  };
}

/**
 * Splices a ring component into the ring edge `source → target`: the request path runs up from the
 * Initiator in array order, the response path down from the Model, so the new component goes
 * before the edge's target stop or after its source stop.
 */
export function spliceRing(config: PipelineConfig, component: Component, edge: { side: Side; source: string; target: string }): PipelineConfig {
  if (component.role !== "ring") fail("NOT_RING", `${component.kind} is not a ring component.`);
  if (component.kind === "llmproxy" && primaryProxy(config)) fail("SINGLETON", "The ring already has an LLMProxy.");
  const stopId = (node: string) => node.replace(/\.(request|response)$/, "");
  const ring = config.components.map((c, i) => ({ c, i })).filter(x => onSide(x.c, edge.side));
  const placed: Component = component.kind === "llmproxy" ? component : { ...component, side: edge.side };
  const before = ring.find(x => x.c.id === stopId(edge.target));
  const after = ring.find(x => x.c.id === stopId(edge.source));
  const lastRing = config.components.reduce((n, c, i) => c.role === "ring" ? i + 1 : n, 0);
  const index = before ? before.i : after ? after.i + 1 : lastRing;
  const components = [...config.components];
  components.splice(index, 0, placed);
  return { ...config, components };
}

const proxyFilters = (config: PipelineConfig, proxyId: string): { i: number; proxy: Component; filters: { request: FilterSpec[]; response: FilterSpec[] } } => {
  const i = at(config, proxyId), proxy = config.components[i]!;
  if (proxy.kind !== "llmproxy") fail("NOT_LLMPROXY", `${proxyId} is not an LLMProxy.`);
  const f = proxy.filters ?? { request: [], response: [] };
  return { i, proxy, filters: { request: [...(f.request ?? [])], response: [...(f.response ?? [])] } };
};
const withFilters = (config: PipelineConfig, i: number, proxy: Component, filters: { request: FilterSpec[]; response: FilterSpec[] }) =>
  replace(config, i, { ...proxy, filters: { ...(proxy.filters ?? {}), request: filters.request, response: filters.response } });

export function insertFilter(config: PipelineConfig, proxyId: string, side: Side, index: number, spec: FilterSpec): PipelineConfig {
  const { i, proxy, filters } = proxyFilters(config, proxyId);
  filters[side].splice(Math.max(0, Math.min(index, filters[side].length)), 0, spec);
  return withFilters(config, i, proxy, filters);
}
export function moveFilter(config: PipelineConfig, proxyId: string, side: Side, from: number, to: number): PipelineConfig {
  const { i, proxy, filters } = proxyFilters(config, proxyId);
  const [spec] = filters[side].splice(from, 1);
  if (spec === undefined) return config;
  filters[side].splice(Math.max(0, Math.min(to, filters[side].length)), 0, spec);
  return withFilters(config, i, proxy, filters);
}
export function removeFilter(config: PipelineConfig, proxyId: string, side: Side, index: number): PipelineConfig {
  const { i, proxy, filters } = proxyFilters(config, proxyId);
  filters[side].splice(index, 1);
  return withFilters(config, i, proxy, filters);
}
export function setFilter(config: PipelineConfig, proxyId: string, side: Side, index: number, spec: FilterSpec): PipelineConfig {
  const { i, proxy, filters } = proxyFilters(config, proxyId);
  if (index < 0 || index >= filters[side].length) fail("NOT_FOUND", "No such filter slot.");
  filters[side][index] = spec;
  return withFilters(config, i, proxy, filters);
}

/** Sets or clears the PSP reference. Clearing sets `psp: null`. */
export const setPsp = (config: PipelineConfig, psp: PspRef | null): PipelineConfig => ({ ...config, psp });

/** Attaches an auxiliary to an LLMProxy half: vector stores become its `vectorStore`, taps get `taps`. */
export function tap(config: PipelineConfig, componentId: string, proxyId: string, side: Side = "response"): PipelineConfig {
  const c = config.components[at(config, componentId)]!;
  if (c.kind === "vector-store") return updateComponent(config, proxyId, { vectorStore: componentId });
  return updateComponent(config, componentId, { taps: `${proxyId}.${side}` });
}

/** Adds a component without attaching it (a free node until it is placed). */
export function addComponent(config: PipelineConfig, component: Component): PipelineConfig {
  if (config.components.some(c => c.id === component.id)) fail("DUPLICATE_ID", `${component.id} is already used.`);
  const info = kindInfo(component.kind);
  if (info?.singleton && config.components.some(c => c.kind === component.kind)) {
    if (component.kind !== "llmproxy" || primaryProxy(config)) fail("SINGLETON", `A pipeline has one ${info.label}.`);
  }
  return { ...config, components: [...config.components, component] };
}

/** Adds a tool-loop component called by the Model. */
export function attachLoop(config: PipelineConfig, component: Component): PipelineConfig {
  const { model } = terminals(config);
  if (!model) return fail("NO_MODEL", "A loop component needs the Model.");
  return addComponent(config, { ...component, caller: model.id });
}

/** Applies serializable edits (quick fixes and the document mode's code actions). */
export function applyEdits(config: PipelineConfig, edits: readonly PipelineEdit[]): PipelineConfig {
  let root: unknown = structuredClone(config);
  for (const edit of edits) {
    if (!edit.path.length) { if (edit.op === "set") root = structuredClone(edit.value); continue; }
    let parent = root as Record<string | number, unknown>;
    for (const key of edit.path.slice(0, -1)) {
      const next = parent[key];
      if (next === null || typeof next !== "object") fail("INVALID_EDIT", `No value at ${edit.path.join("/")}.`);
      parent = next as Record<string | number, unknown>;
    }
    const last = edit.path[edit.path.length - 1]!;
    if (edit.op === "set") parent[last] = structuredClone(edit.value);
    else if (Array.isArray(parent)) parent.splice(Number(last), 1);
    else delete parent[last];
  }
  return root as PipelineConfig;
}
