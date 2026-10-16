// SPDX-License-Identifier: Apache-2.0
/** Reviewer views of a proposed change: which nodes and transitions differ, and a line diff of the text. */
import { stableStringify } from "../lib/format";
import { childNodes, formatSection, hasChildNodes, parsePsp, scopeGraph, type Document, type Path, type Section } from "./model";

export interface NodeChange { scope: string[]; key: string; nodeType: string }
export interface TransitionChange { scope: string[]; source: string; target: string; condition: string | null }
export interface ChangeSummary {
  parsed: boolean;
  nodes: { added: NodeChange[]; removed: NodeChange[]; changed: NodeChange[] };
  transitions: { added: TransitionChange[]; removed: TransitionChange[]; changed: TransitionChange[] };
}

/** A node's own content: attributes and blocks, not its child nodes, so a child edit is not its parent's. */
const own = (s: Section) => stableStringify({
  attributes: s.attributes,
  blocks: s.children.map(c => c.kind === "text" ? c.value.trim() : c.attributes.type === "node" || c.attributes.type === "transitions" ? "" : formatSection(c)).filter(Boolean)
});
function collect(doc: Document) {
  const nodes = new Map<string, { change: NodeChange; signature: string }>();
  const edges = new Map<string, { change: TransitionChange; signature: string }>();
  const walk = (path: Path, scope: string[]) => {
    const graph = scopeGraph(doc, path);
    const seen = new Map<string, number>();
    for (const e of graph.edges) {
      const pair = `${e.source}\u0000${e.target}`, n = (seen.get(pair) ?? 0) + 1;
      seen.set(pair, n);
      edges.set(`${scope.join("/")}\u0001${pair}\u0001${n}`, { change: { scope, source: e.source, target: e.target, condition: e.condition }, signature: stableStringify(e.entry) });
    }
    for (const n of childNodes(doc, path)) {
      nodes.set([...scope, n.key].join("/"), { change: { scope, key: n.key, nodeType: n.nodeType }, signature: own(n.section) });
      if (hasChildNodes(n.section)) walk(n.path, [...scope, n.key]);
    }
  };
  walk([], []);
  return { nodes, edges };
}
function compare<T>(before: Map<string, { change: T; signature: string }>, after: Map<string, { change: T; signature: string }>) {
  const added: T[] = [], removed: T[] = [], changed: T[] = [];
  for (const [k, v] of after) { const old = before.get(k); if (!old) added.push(v.change); else if (old.signature !== v.signature) changed.push(v.change); }
  for (const [k, v] of before) if (!after.has(k)) removed.push(v.change);
  return { added, removed, changed };
}
export function summarizeChanges(before: string | null, after: string): ChangeSummary {
  const a = before === null ? null : parsePsp(before), b = parsePsp(after);
  const empty = { added: [], removed: [], changed: [] };
  if (!b.ok || (a !== null && !a.ok)) return { parsed: false, nodes: empty, transitions: empty };
  const left = a ? collect(a.doc) : { nodes: new Map(), edges: new Map() }, right = collect(b.doc);
  return { parsed: true, nodes: compare(left.nodes, right.nodes), transitions: compare(left.edges, right.edges) };
}

export interface DiffLine { kind: "same" | "add" | "del"; text: string; left: number | null; right: number | null }
export type DiffRow = DiffLine | { kind: "skip"; count: number };
/**
 * Line diff by longest common subsequence after trimming the shared head and tail. Unchanged runs
 * longer than twice the context collapse into a skip row.
 */
export function lineDiff(before: string, after: string, context = 3): DiffRow[] {
  const a = before.split("\n"), b = after.split("\n");
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head++;
  let tail = 0;
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++;
  const x = a.slice(head, a.length - tail), y = b.slice(head, b.length - tail);
  const lines: DiffLine[] = a.slice(0, head).map((text, i) => ({ kind: "same", text, left: i + 1, right: i + 1 }));
  if (x.length * y.length > 4_000_000) {
    // Too large for a table: show the middle as a removal then an addition.
    x.forEach((text, i) => lines.push({ kind: "del", text, left: head + i + 1, right: null }));
    y.forEach((text, i) => lines.push({ kind: "add", text, left: null, right: head + i + 1 }));
  } else {
    const table = Array.from({ length: x.length + 1 }, () => new Uint32Array(y.length + 1));
    for (let i = x.length - 1; i >= 0; i--) for (let j = y.length - 1; j >= 0; j--) table[i]![j] = x[i] === y[j] ? table[i + 1]![j + 1]! + 1 : Math.max(table[i + 1]![j]!, table[i]![j + 1]!);
    let i = 0, j = 0;
    while (i < x.length || j < y.length) {
      if (i < x.length && j < y.length && x[i] === y[j]) { lines.push({ kind: "same", text: x[i]!, left: head + i + 1, right: head + j + 1 }); i++; j++; }
      else if (i < x.length && (j === y.length || table[i + 1]![j]! >= table[i]![j + 1]!)) { lines.push({ kind: "del", text: x[i]!, left: head + i + 1, right: null }); i++; }
      else { lines.push({ kind: "add", text: y[j]!, left: null, right: head + j + 1 }); j++; }
    }
  }
  a.slice(a.length - tail).forEach((text, k) => lines.push({ kind: "same", text, left: a.length - tail + k + 1, right: b.length - tail + k + 1 }));
  const rows: DiffRow[] = [];
  for (let k = 0; k < lines.length;) {
    if (lines[k]!.kind !== "same") { rows.push(lines[k]!); k++; continue; }
    let end = k;
    while (end < lines.length && lines[end]!.kind === "same") end++;
    const run = end - k, first = k === 0, last = end === lines.length;
    const keepHead = first ? 0 : context, keepTail = last ? 0 : context;
    if (run > keepHead + keepTail + 1) {
      rows.push(...lines.slice(k, k + keepHead));
      rows.push({ kind: "skip", count: run - keepHead - keepTail });
      rows.push(...lines.slice(end - keepTail, end));
    } else rows.push(...lines.slice(k, end));
    k = end;
  }
  return rows;
}
