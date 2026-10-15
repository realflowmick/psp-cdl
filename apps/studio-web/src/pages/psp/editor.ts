// SPDX-License-Identifier: Apache-2.0
import { createContext, useCallback, useContext, useMemo, useState } from "react";
import type { Document, GraphEdge, Path, ScopeGraph, Section } from "../../psp/model";
import { serializeLayout, type Layout, type Point } from "../../psp/layout";
import type { TabId } from "../../psp/kinds";

/** What the editor saves: the PSP text and the sidecar layout. */
export interface Snapshot { text: string; layout: Layout }
export type Selection = { kind: "node" | "edge" | "missing"; key: string } | null;
export const selectionParam = (s: Selection): string | null => s ? `${s.kind[0]}:${s.key}` : null;
export function parseSelection(raw: string | null): Selection {
  if (!raw) return null;
  const kind = ({ n: "node", e: "edge", m: "missing" } as const)[raw[0] as "n" | "e" | "m"];
  return kind && raw[1] === ":" ? { kind, key: raw.slice(2) } : null;
}

interface History { past: Snapshot[]; present: Snapshot; future: Snapshot[]; key: string | null; at: number }
const LIMIT = 200, COALESCE_MS = 1200;
const same = (a: Snapshot, b: Snapshot) => a.text === b.text && serializeLayout(a.layout) === serializeLayout(b.layout);

/**
 * Undoable editor state. Typing into one field coalesces into a single step; a node drag is one step
 * from where it started. `saved` tracks what is on disk for the unsaved-change guard.
 */
export function useSnapshotHistory(initial: Snapshot) {
  const [h, setH] = useState<History>({ past: [], present: initial, future: [], key: null, at: 0 });
  const [saved, setSaved] = useState(initial);
  const commit = useCallback((next: Snapshot | ((present: Snapshot) => Snapshot), coalesce?: string) => setH(prev => {
    const value = typeof next === "function" ? next(prev.present) : next;
    if (same(value, prev.present)) return prev;
    const now = Date.now();
    if (coalesce && prev.key === coalesce && now - prev.at < COALESCE_MS) return { ...prev, present: value, future: [], at: now };
    return { past: [...prev.past, prev.present].slice(-LIMIT), present: value, future: [], key: coalesce ?? null, at: now };
  }), []);
  /** Replaces the present without a history step, for live dragging. */
  const preview = useCallback((next: (present: Snapshot) => Snapshot) => setH(prev => ({ ...prev, present: next(prev.present) })), []);
  /** Records `before` as the step the preview started from. */
  const checkpoint = useCallback((before: Snapshot) => setH(prev => same(before, prev.present) ? prev : { past: [...prev.past, before].slice(-LIMIT), present: prev.present, future: [], key: null, at: 0 }), []);
  const undo = useCallback(() => setH(prev => prev.past.length ? { past: prev.past.slice(0, -1), present: prev.past.at(-1)!, future: [prev.present, ...prev.future], key: null, at: 0 } : prev), []);
  const redo = useCallback(() => setH(prev => prev.future.length ? { past: [...prev.past, prev.present], present: prev.future[0]!, future: prev.future.slice(1), key: null, at: 0 } : prev), []);
  const dirty = useMemo(() => !same(h.present, saved), [h.present, saved]);
  return { present: h.present, saved, dirty, canUndo: h.past.length > 0, canRedo: h.future.length > 0, commit, preview, checkpoint, undo, redo, markSaved: setSaved };
}

export interface NodeRef { key: string; path: Path; section: Section; nodeType: string }
/** Everything the canvas, sidebar and inspector need, provided once by the editor page. */
export interface EditorApi {
  file: string;
  doc: Document;
  graph: ScopeGraph;
  scope: string[];
  scopePath: Path;
  selection: Selection;
  tab: string;
  positions: Record<string, Point>;
  setTab(tab: TabId | string): void;
  select(selection: Selection, tab?: string): void;
  openScope(scope: string[], selection?: Selection): void;
  /** Applies a document edit as one undoable step; `coalesce` merges keystrokes in one field. */
  apply(edit: (doc: Document) => Document, coalesce?: string): void;
  rename(node: NodeRef, to: string): void;
  addNode(type: string, at?: Point, id?: string): void;
  deleteNode(key: string): void;
  connect(source: string, target: string): void;
  retarget(edge: GraphEdge, target: string): void;
  deleteEdge(edge: GraphEdge): void;
  moveNode(key: string, to: Point, dragging: boolean): void;
  startDrag(): void;
  endDrag(): void;
  autoLayout(): void;
  report(message: string | null): void;
}
export const EditorContext = createContext<EditorApi | null>(null);
export function useEditor(): EditorApi {
  const api = useContext(EditorContext);
  if (!api) throw new Error("useEditor outside the PSP editor");
  return api;
}
