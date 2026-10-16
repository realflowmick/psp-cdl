// SPDX-License-Identifier: Apache-2.0
/**
 * One store for the detail route: the parsed configuration plus editor-only state. Nothing in the
 * configuration is editor-only and nothing editor-only is serialized; derived views (cards, edges,
 * ring order, registrations) are selectors over it.
 */
import { create } from "zustand";
import {
  formatConfig, validatePipeline, type PipelineConfig, type PipelineRow, type PipelineRunRecord, type PipelineSession, type Problem, type PspSummary, type Side, type ValidationEnv
} from "@psp-cdl/studio-core";
import type { DriftReport, VectorStatus } from "../lib/api";
import type { DragItem, DropIntent } from "./drop";
import type { Point } from "./layout";

export interface Selection { componentId?: string; filter?: { componentId: string; side: Side; index: number }; psp?: boolean }
export type DialogTarget = { kind: "component"; componentId: string; tab?: string } | { kind: "filter"; componentId: string; side: Side; index: number } | { kind: "psp"; tab?: string } | { kind: "pipeline" };
export interface RunState { session: PipelineSession | null; records: PipelineRunRecord[]; busy: boolean; error: string | null }

export interface PipelineEditorState {
  row: PipelineRow | null;
  config: PipelineConfig | null;
  /** formatConfig of the saved configuration, for the dirty check. */
  savedText: string;
  past: PipelineConfig[];
  future: PipelineConfig[];
  lastEdit: { key: string | null; at: number };
  env: ValidationEnv;
  problems: Problem[];
  selection: Selection;
  drag: { item: DragItem; intent?: DropIntent; label?: string } | null;
  free: Record<string, Point>;
  dialog: DialogTarget | null;
  run: RunState;
  drift: Record<string, DriftReport>;
  vectors: Record<string, VectorStatus>;
  notice: string | null;
  load(row: PipelineRow): void;
  /** One undoable step; `coalesce` merges consecutive keystrokes in one field. */
  apply(next: PipelineConfig | ((config: PipelineConfig) => PipelineConfig), coalesce?: string): void;
  undo(): void;
  redo(): void;
  markSaved(row: PipelineRow): void;
  setEnv(env: ValidationEnv): void;
  select(selection: Selection): void;
  setDrag(drag: PipelineEditorState["drag"]): void;
  setFree(id: string, at: Point | null): void;
  openDialog(target: DialogTarget | null): void;
  setRun(patch: Partial<RunState>): void;
  setDrift(report: DriftReport): void;
  setVectors(status: VectorStatus): void;
  report(notice: string | null): void;
}

const LIMIT = 200, COALESCE_MS = 1200;
const EMPTY_RUN: RunState = { session: null, records: [], busy: false, error: null };
const derive = (config: PipelineConfig | null, env: ValidationEnv): Problem[] => config ? validatePipeline(config, env) : [];

export const usePipelineEditor = create<PipelineEditorState>()((set, get) => ({
  row: null, config: null, savedText: "", past: [], future: [], lastEdit: { key: null, at: 0 }, env: {}, problems: [], selection: {}, drag: null, free: {}, dialog: null,
  run: EMPTY_RUN, drift: {}, vectors: {}, notice: null,
  load: row => set({
    row, config: row.config, savedText: formatConfig(row.config), past: [], future: [], lastEdit: { key: null, at: 0 }, env: {}, problems: derive(row.config, {}),
    selection: {}, drag: null, free: {}, dialog: null, run: EMPTY_RUN, drift: {}, vectors: {}, notice: null
  }),
  apply: (next, coalesce) => {
    const { config, past, lastEdit, env } = get();
    if (!config) return;
    const value = typeof next === "function" ? next(config) : next;
    if (value === config || formatConfig(value) === formatConfig(config)) return;
    const now = Date.now();
    const merge = coalesce !== undefined && lastEdit.key === coalesce && now - lastEdit.at < COALESCE_MS;
    set({ config: value, past: merge ? past : [...past, config].slice(-LIMIT), future: [], lastEdit: { key: coalesce ?? null, at: now }, problems: derive(value, env) });
  },
  undo: () => {
    const { past, config, future, env } = get();
    if (!past.length || !config) return;
    const previous = past.at(-1)!;
    set({ config: previous, past: past.slice(0, -1), future: [config, ...future], lastEdit: { key: null, at: 0 }, problems: derive(previous, env) });
  },
  redo: () => {
    const { past, config, future, env } = get();
    if (!future.length || !config) return;
    const next = future[0]!;
    set({ config: next, past: [...past, config], future: future.slice(1), lastEdit: { key: null, at: 0 }, problems: derive(next, env) });
  },
  markSaved: row => set(state => ({ row, savedText: formatConfig(row.config), config: state.config && formatConfig(state.config) === formatConfig(row.config) ? state.config : state.config })),
  setEnv: env => set(state => ({ env, problems: derive(state.config, env) })),
  select: selection => set({ selection }),
  setDrag: drag => set({ drag }),
  setFree: (id, at) => set(state => { const free = { ...state.free }; if (at) free[id] = at; else delete free[id]; return { free }; }),
  openDialog: dialog => set({ dialog }),
  setRun: patch => set(state => ({ run: { ...state.run, ...patch } })),
  setDrift: report => set(state => ({ drift: { ...state.drift, [report.proxyId]: report } })),
  setVectors: status => set(state => ({ vectors: { ...state.vectors, [status.storeId]: status } })),
  report: notice => set({ notice })
}));

export const isDirty = (state: Pick<PipelineEditorState, "config" | "savedText">): boolean => !!state.config && formatConfig(state.config) !== state.savedText;
export const pspSummaryOf = (env: ValidationEnv): PspSummary | null => env.psp?.status === "resolved" ? env.psp.summary : null;
