// SPDX-License-Identifier: Apache-2.0
/**
 * Editing model for PSP markup. Parsing uses the reference codec; everything here is a pure
 * transformation of the codec's document tree. The editor authors PSP text only: it never evaluates
 * transition conditions or decides routes, which remain the model's work inside its context window.
 */
import { parseMarkup, PspError, type Document, type PspNode, type Section, type TextNode } from "@psp-cdl/core";

export type { Document, PspNode, Section };
export type Container = Document | Section;
/** Child indices from the document root to a section. */
export type Path = readonly number[];

const INDENT = "  ";
export const ind = (depth: number): string => INDENT.repeat(Math.max(0, depth));
const text = (value: string): TextNode => ({ kind: "text", value });
export const isSection = (n: PspNode | undefined): n is Section => n?.kind === "section";
export const isNodeSection = (n: PspNode | undefined): n is Section => isSection(n) && n.attributes.type === "node";
const isBlank = (n: PspNode | undefined): boolean => n?.kind === "text" && /^\s*$/.test(n.value);
const isRecord = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const setOwn = (target: Record<string, string>, key: string, value: string): void => {
  Object.defineProperty(target, key, { value, enumerable: true, writable: true, configurable: true });
};

// ---------------------------------------------------------------- parse and format

export type ParseResult = { ok: true; doc: Document } | { ok: false; error: string; line: number; column: number };

export function parsePsp(source: string): ParseResult {
  try {
    const doc = parseMarkup(source);
    delete doc.source;
    return { ok: true, doc };
  } catch (e) {
    const code = e instanceof PspError ? e.code : "INVALID_MARKUP";
    const offset = e instanceof PspError && typeof e.offset === "number" ? e.offset : null;
    const { line, column } = offset === null ? { line: 0, column: 0 } : position(source, offset);
    return { ok: false, error: code, line, column };
  }
}
/** Converts a UTF-8 byte offset from the codec into a 1-based line and column. */
function position(source: string, byteOffset: number): { line: number; column: number } {
  const encoder = new TextEncoder();
  let bytes = 0, line = 1, column = 1;
  for (const ch of source) {
    if (bytes >= byteOffset) break;
    bytes += encoder.encode(ch).length;
    if (ch === "\n") { line++; column = 1; } else column++;
  }
  return { line, column };
}

const TOKEN = /^[A-Za-z0-9_.-]+$/;
const BARE = new Set(["type", "node-type", "content-type"]);
function emitTag(attributes: Record<string, string>): string {
  const keys = Object.keys(attributes);
  const ordered = keys.includes("type") ? ["type", ...keys.filter(k => k !== "type")] : keys;
  return ordered.map(k => {
    const v = attributes[k]!;
    return `${k}=${BARE.has(k) && TOKEN.test(v) ? v : JSON.stringify(v)}`;
  }).join(" ");
}
/** Escapes only what the codec would otherwise read as markup, so JSON and prose stay readable. */
export function escapeText(value: string): string {
  let out = "";
  for (let i = 0; i < value.length; i++) {
    const c = value[i]!;
    if (c === "\\") {
      const next = value[i + 1];
      out += next === undefined || next === "\\" || value.startsWith("${psp", i + 1) || value.startsWith("${/psp", i + 1) ? "\\\\" : "\\";
    } else if (c === "$" && (value.startsWith("${psp", i) || value.startsWith("${/psp", i))) out += "\\$";
    else out += c;
  }
  return out;
}
/**
 * Serializes with `type` first and keeps every text node verbatim, so whitespace and content the
 * author wrote survive. Tags are written on one line; empty sections are self-closing.
 */
export function formatPsp(doc: Container): string {
  const emit = (node: PspNode): string => {
    if (node.kind === "text") return escapeText(node.value);
    const tag = emitTag(node.attributes);
    return node.children.length ? "${psp " + tag + "}" + node.children.map(emit).join("") + "${/psp}" : "${psp " + tag + " /}";
  };
  return doc.children.map(emit).join("");
}
export function formatSection(section: Section): string { return formatPsp({ kind: "document", children: [section] }); }

// ---------------------------------------------------------------- tree access

export function containerAt(doc: Document, path: Path): Container | undefined {
  let current: Container = doc;
  for (const i of path) {
    const child: PspNode | undefined = current.children[i];
    if (!isSection(child)) return undefined;
    current = child;
  }
  return current;
}
export function sectionAt(doc: Document, path: Path): Section | undefined {
  const c = path.length ? containerAt(doc, path) : undefined;
  return c && c.kind === "section" ? c : undefined;
}
export function updateAt(doc: Document, path: Path, fn: (c: Container) => Container): Document {
  const go = (c: Container, depth: number): Container => {
    if (depth === path.length) return fn(c);
    const i = path[depth]!, child = c.children[i];
    if (!isSection(child)) throw new Error("The section moved; reload the editor.");
    const children = c.children.slice();
    children[i] = go(child, depth + 1) as Section;
    return { ...c, children };
  };
  return go(doc, 0) as Document;
}
const updateSection = (doc: Document, path: Path, fn: (s: Section) => Section): Document => updateAt(doc, path, c => fn(c as Section));

function mergeText(children: PspNode[]): PspNode[] {
  const out: PspNode[] = [];
  for (const child of children) {
    if (child.kind === "text") {
      if (!child.value) continue;
      const last = out.at(-1);
      if (last?.kind === "text") { out[out.length - 1] = text(last.value + child.value); continue; }
    }
    out.push(child);
  }
  return out;
}
/**
 * Inserts a section with indentation that matches its depth. `before` is the index of the child it
 * should precede, or null to append after the last section.
 */
export function insertSection(children: readonly PspNode[], section: Section, depth: number, before: number | null): PspNode[] {
  const out = children.slice(), pad = text("\n" + ind(depth));
  const limit = before ?? out.length;
  let previous = -1;
  for (let i = 0; i < limit; i++) if (isSection(out[i])) previous = i;
  if (previous >= 0) out.splice(previous + 1, 0, pad, section);
  else if (before !== null) out.splice(before, 0, ...(isBlank(out[before - 1]) ? [section, pad] : [pad, section, pad]));
  else if (out.every(isBlank)) return [pad, section, text("\n" + ind(depth - 1))];
  else out.push(pad, section, text("\n" + ind(depth - 1)));
  return mergeText(out);
}
export function removeChild(children: readonly PspNode[], index: number): PspNode[] {
  const out = children.slice();
  const start = isBlank(out[index - 1]) ? index - 1 : index;
  out.splice(start, index - start + 1);
  return out.every(isBlank) ? [] : mergeText(out);
}

// ---------------------------------------------------------------- blocks and attributes

/** Leaf sections such as system, output-schema and the config blocks hold one text body. */
export function sectionText(section: Section): string {
  return section.children.map(c => c.kind === "text" ? c.value : "").join("");
}
const padding = (value: string) => {
  const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(value)!;
  return { lead: m[1]!, body: m[2]!, trail: m[3]! };
};
export const blockBody = (section: Section): string => padding(sectionText(section)).body;
/** Replaces a leaf body and keeps the surrounding whitespace the author used. */
export function withBody(section: Section, body: string, depth: number): Section {
  const old = section.children.length ? padding(sectionText(section)) : null;
  const keep = old !== null && (old.lead !== "" || old.trail !== "");
  const multi = body.includes("\n");
  const lead = keep ? old!.lead : multi ? "\n" : "";
  const trail = keep ? old!.trail : multi ? "\n" + ind(depth) : "";
  return { ...section, children: body === "" && !keep ? [] : [text(lead + body + trail)] };
}
export function withAttributes(section: Section, patch: Record<string, string | undefined>): Section {
  const attributes: Record<string, string> = {};
  for (const [k, v] of Object.entries(section.attributes)) {
    if (!Object.hasOwn(patch, k)) setOwn(attributes, k, v);
    else if (patch[k] !== undefined) setOwn(attributes, k, patch[k]!);
  }
  for (const [k, v] of Object.entries(patch)) if (!Object.hasOwn(section.attributes, k) && v !== undefined) setOwn(attributes, k, v);
  return { ...section, attributes };
}
export const setAttributes = (doc: Document, path: Path, patch: Record<string, string | undefined>): Document =>
  updateSection(doc, path, s => withAttributes(s, patch));

/** Section order inside a node, used to place a newly added block where an author would expect it. */
const RANK: Record<string, number> = {
  machine: 0, system: 1, context: 2, "context-ref": 2, "workflow-state": 3, "threat-policy": 4, "output-schema": 5,
  "connector-config": 6, "checkpoint-config": 6, "loop-config": 6, "reset-config": 6, settings: 6, link: 7, "post-completion": 8,
  node: 10, transitions: 11, output: 12
};
const rank = (type: string | undefined) => RANK[type ?? ""] ?? 9;
export function blockIndex(section: Container, type: string): number {
  return section.children.findIndex(c => isSection(c) && c.attributes.type === type);
}
export function blockOf(section: Container, type: string): Section | undefined {
  const i = blockIndex(section, type);
  return i < 0 ? undefined : section.children[i] as Section;
}
export function blocksOf(section: Container, type: string): { section: Section; index: number }[] {
  return section.children.flatMap((c, index) => isSection(c) && c.attributes.type === type ? [{ section: c, index }] : []);
}
/** Inserts a child section at its conventional position: blocks first, then nodes, then transitions. */
export function addChildSection(doc: Document, parent: Path, child: Section): { doc: Document; path: Path } {
  const container = containerAt(doc, parent);
  if (!container) throw new Error("The parent section no longer exists.");
  const r = rank(child.attributes.type);
  const firstLater = container.children.findIndex(c => isSection(c) && rank(c.attributes.type) > r);
  const children = insertSection(container.children, child, parent.length, firstLater < 0 ? null : firstLater);
  const next = updateAt(doc, parent, c => ({ ...c, children }));
  return { doc: next, path: [...parent, children.indexOf(child)] };
}
export function removeSection(doc: Document, path: Path): Document {
  const parent = path.slice(0, -1), index = path[path.length - 1]!;
  return updateAt(doc, parent, c => ({ ...c, children: removeChild(c.children, index) }));
}
export function replaceSection(doc: Document, path: Path, section: Section): Document {
  const parent = path.slice(0, -1), index = path[path.length - 1]!;
  return updateAt(doc, parent, c => { const children = c.children.slice(); children[index] = section; return { ...c, children }; });
}
/** Sets, creates or (with null) removes a leaf block of a node, such as its system instructions. */
export function setBlock(doc: Document, nodePath: Path, type: string, body: string | null, attributes: Record<string, string> = {}): Document {
  const node = containerAt(doc, nodePath);
  if (!node) return doc;
  const index = blockIndex(node, type);
  if (body === null) return index < 0 ? doc : removeSection(doc, [...nodePath, index]);
  if (index >= 0) return updateSection(doc, [...nodePath, index], s => withBody(s, body, nodePath.length));
  const block = withBody({ kind: "section", attributes: { type, ...attributes }, children: [] }, body, nodePath.length);
  return addChildSection(doc, nodePath, block).doc;
}
export const newSection = (attributes: Record<string, string>, body = ""): Section =>
  ({ kind: "section", attributes: { ...attributes }, children: body ? [text(body)] : [] });
/** A node with its blocks laid out one per line at the given depth. */
export function buildSection(attributes: Record<string, string>, blocks: Section[], depth: number): Section {
  if (!blocks.length) return newSection(attributes);
  const children: PspNode[] = [];
  for (const b of blocks) children.push(text("\n" + ind(depth + 1)), b);
  children.push(text("\n" + ind(depth)));
  return { kind: "section", attributes: { ...attributes }, children };
}

// ---------------------------------------------------------------- scopes and graph

export const nodeKey = (s: Section, index: number): string => s.attributes.id || s.attributes.name || `@${index}`;
export interface ChildNode { key: string; index: number; path: Path; section: Section; nodeType: string }
export function childNodes(doc: Document, scopePath: Path): ChildNode[] {
  const container = containerAt(doc, scopePath);
  if (!container) return [];
  return container.children.flatMap((c, index) => isNodeSection(c)
    ? [{ key: nodeKey(c, index), index, path: [...scopePath, index], section: c, nodeType: c.attributes["node-type"] ?? "" }] : []);
}
export const hasChildNodes = (s: Section): boolean => s.children.some(isNodeSection);
const CONTAINER_TYPES = new Set(["application", "composite", "loop"]);
export const isContainerNode = (s: Section): boolean => CONTAINER_TYPES.has(s.attributes["node-type"] ?? "") || hasChildNodes(s);

/** Resolves a scope given as node keys from the document root. */
export function resolveScope(doc: Document, keys: readonly string[]): Path | null {
  let path: Path = [];
  for (const key of keys) {
    const child = childNodes(doc, path).find(n => n.key === key);
    if (!child) return null;
    path = child.path;
  }
  return path;
}
export function scopeKeys(doc: Document, path: Path): string[] {
  const keys: string[] = [];
  for (let depth = 1; depth <= path.length; depth++) {
    const s = sectionAt(doc, path.slice(0, depth));
    if (!s) break;
    keys.push(nodeKey(s, path[depth - 1]!));
  }
  return keys;
}
/** A single top-level application opens at its own scope; anything else opens at the document. */
export function defaultScope(doc: Document): string[] {
  const top = childNodes(doc, []);
  return top.length === 1 && isContainerNode(top[0]!.section) ? [top[0]!.key] : [];
}

export interface Transition { [key: string]: unknown; target_node?: unknown; source_node?: unknown; condition?: unknown; priority?: unknown }
export interface GraphEdge {
  key: string;
  /** Path of the transitions section that declares the entry, and the entry's index in it. */
  block: Path; index: number;
  /** The node whose own transitions declare this entry, or null for the scope's transitions. */
  owner: string | null;
  source: string; target: string;
  condition: string | null; priority: number | null;
  entry: Transition;
}
export interface TransitionsBlock { path: Path; owner: string | null; entries: unknown[] | null; error: string | null }
export interface ScopeGraph { path: Path; container: Container; nodes: ChildNode[]; edges: GraphEdge[]; blocks: TransitionsBlock[]; missing: string[]; entry: string | null }

export function parseTransitions(section: Section): { entries: unknown[] } | { error: string } {
  const body = sectionText(section).trim();
  if (!body) return { entries: [] };
  try {
    const value: unknown = JSON.parse(body);
    return Array.isArray(value) ? { entries: value } : { error: "Transitions must be a JSON array." };
  } catch (e) { return { error: `Transitions are not valid JSON: ${(e as Error).message}` }; }
}
export const edgeKey = (block: Path, index: number): string => `${block.join(".")}#${index}`;

/**
 * Edges among the children of one scope, in order of appearance. A scope's transitions name a
 * `source_node`; a child's own transitions without one leave from that child (PSP 15.2).
 */
export function scopeGraph(doc: Document, path: Path): ScopeGraph {
  const container = containerAt(doc, path) ?? doc;
  const nodes = childNodes(doc, path);
  const self = path.length ? nodeKey(container as Section, path[path.length - 1]!) : null;
  const edges: GraphEdge[] = [], blocks: TransitionsBlock[] = [];
  const read = (section: Section, blockPath: Path, owner: string | null) => {
    const parsed = parseTransitions(section);
    blocks.push({ path: blockPath, owner, entries: "entries" in parsed ? parsed.entries : null, error: "error" in parsed ? parsed.error : null });
    if (!("entries" in parsed)) return;
    parsed.entries.forEach((entry, index) => {
      if (!isRecord(entry) || typeof entry.target_node !== "string") return;
      const declared = typeof entry.source_node === "string" ? entry.source_node : null;
      let source: string | null;
      if (owner === null) source = declared !== null && declared !== self ? declared : null;
      else source = declared === null || declared === owner ? owner : null;
      if (source === null) return;
      edges.push({
        key: edgeKey(blockPath, index), block: blockPath, index, owner, source, target: entry.target_node, entry,
        condition: typeof entry.condition === "string" ? entry.condition : null,
        priority: typeof entry.priority === "number" ? entry.priority : null
      });
    });
  };
  container.children.forEach((child, i) => {
    if (!isSection(child)) return;
    if (child.attributes.type === "transitions") read(child, [...path, i], null);
    else if (child.attributes.type === "node") {
      const owner = nodeKey(child, i);
      child.children.forEach((inner, j) => { if (isSection(inner) && inner.attributes.type === "transitions") read(inner, [...path, i, j], owner); });
    }
  });
  const keys = new Set(nodes.map(n => n.key));
  const missing = [...new Set(edges.flatMap(e => [e.source, e.target]).filter(k => !keys.has(k)))];
  return { path, container, nodes, edges, blocks, missing, entry: nodes[0]?.key ?? null };
}

// ---------------------------------------------------------------- transition edits

function writeTransitions(section: Section, entries: unknown[], depth: number): Section {
  const body = entries.length ? "[\n" + entries.map(e => ind(depth + 1) + JSON.stringify(e)).join(",\n") + "\n" + ind(depth) + "]" : "[]";
  const old = padding(sectionText(section)), has = section.children.length > 0;
  return { ...section, children: [text((has ? old.lead : "\n" + ind(depth)) + body + (has ? old.trail : "\n" + ind(depth)))] };
}
function rewriteBlock(doc: Document, block: Path, fn: (entries: unknown[]) => unknown[]): Document {
  const section = sectionAt(doc, block);
  if (!section) throw new Error("The transitions section moved; reload the editor.");
  const parsed = parseTransitions(section);
  if (!("entries" in parsed)) throw new Error(parsed.error);
  const entries = fn(parsed.entries.slice());
  if (!entries.length) return removeSection(doc, block);
  return replaceSection(doc, block, writeTransitions(section, entries, block.length - 1));
}
export function updateTransition(doc: Document, edge: Pick<GraphEdge, "block" | "index">, next: Transition): Document {
  return rewriteBlock(doc, edge.block, entries => { entries[edge.index] = next; return entries; });
}
/** Merges fields into an entry; undefined removes a field. Unknown fields are kept. */
export function patchTransition(doc: Document, edge: Pick<GraphEdge, "block" | "index" | "entry">, patch: Record<string, unknown>): Document {
  const next: Transition = { ...edge.entry };
  for (const [k, v] of Object.entries(patch)) { if (v === undefined) delete next[k]; else next[k] = v; }
  return updateTransition(doc, edge, next);
}
export function deleteTransition(doc: Document, edge: Pick<GraphEdge, "block" | "index">): Document {
  return rewriteBlock(doc, edge.block, entries => entries.filter((_, i) => i !== edge.index));
}
/** Swaps an entry with the previous or next entry from the same source in the same section. */
export function moveTransition(doc: Document, graph: ScopeGraph, edge: GraphEdge, direction: -1 | 1): { doc: Document; key: string } {
  const peers = graph.edges.filter(e => e.source === edge.source && e.block.join(".") === edge.block.join("."));
  const other = peers[peers.findIndex(e => e.key === edge.key) + direction];
  if (!other) return { doc, key: edge.key };
  const next = rewriteBlock(doc, edge.block, entries => { const a = entries[edge.index]; entries[edge.index] = entries[other.index]; entries[other.index] = a; return entries; });
  return { doc: next, key: edgeKey(edge.block, other.index) };
}
/**
 * Adds a transition. It joins the source node's own transitions when that node already declares
 * them that way; otherwise it goes to the scope's transitions with `source_node`.
 */
export function addTransition(doc: Document, scopePath: Path, source: string, target: string, fields: Record<string, unknown> = {}): { doc: Document; key: string } {
  const graph = scopeGraph(doc, scopePath);
  const node = graph.nodes.find(n => n.key === source);
  const local = node && graph.blocks.find(b => b.owner === source && b.entries && b.entries.length > 0 && b.entries.every(e => isRecord(e) && (e.source_node === undefined || e.source_node === source)));
  if (local) {
    const index = local.entries!.length;
    return { doc: rewriteBlock(doc, local.path, entries => [...entries, { target_node: target, ...fields }]), key: edgeKey(local.path, index) };
  }
  const scoped = graph.blocks.filter(b => b.owner === null);
  const usable = scoped.find(b => b.entries !== null);
  if (usable) {
    const index = usable.entries!.length;
    return { doc: rewriteBlock(doc, usable.path, entries => [...entries, { source_node: source, target_node: target, ...fields }]), key: edgeKey(usable.path, index) };
  }
  if (scoped.length) throw new Error("Fix the invalid transitions JSON in this scope before adding transitions.");
  const block = writeTransitions(newSection({ type: "transitions", "content-type": "json" }), [{ source_node: source, target_node: target, ...fields }], scopePath.length);
  const added = addChildSection(doc, scopePath, block);
  return { doc: added.doc, key: edgeKey(added.path, 0) };
}

// ---------------------------------------------------------------- node edits

export function addNode(doc: Document, scopePath: Path, section: Section): { doc: Document; path: Path } {
  return addChildSection(doc, scopePath, section);
}
/** Removes a node and every transition in its scope that leaves from or arrives at it. */
export function deleteNode(doc: Document, scopePath: Path, key: string): Document {
  let next = doc;
  const graph = scopeGraph(doc, scopePath);
  const doomed = graph.edges.filter(e => (e.source === key || e.target === key) && e.owner !== key);
  const byBlock = new Map<string, { block: Path; indexes: Set<number> }>();
  for (const e of doomed) {
    const id = e.block.join(".");
    (byBlock.get(id) ?? byBlock.set(id, { block: e.block, indexes: new Set() }).get(id)!).indexes.add(e.index);
  }
  // Later sections first, so removing an emptied transitions section cannot shift an earlier path.
  const ordered = [...byBlock.values()].sort((a, b) => comparePaths(b.block, a.block));
  for (const { block, indexes } of ordered) next = rewriteBlock(next, block, entries => entries.filter((_, i) => !indexes.has(i)));
  const node = childNodes(next, scopePath).find(n => n.key === key);
  return node ? removeSection(next, node.path) : next;
}
function comparePaths(a: Path, b: Path): number {
  for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) return a[i]! - b[i]!;
  return a.length - b.length;
}
/** Renames a node and the references to it in its scope: transitions and reset targets. */
export function renameNode(doc: Document, scopePath: Path, from: string, to: string): Document {
  const graph = scopeGraph(doc, scopePath);
  const node = graph.nodes.find(n => n.key === from);
  if (!node || from === to) return doc;
  let next = doc;
  const inScope = new Set(graph.edges.map(e => e.key));
  for (const block of graph.blocks) {
    if (!block.entries) continue;
    let changed = false;
    // Only entries that belong to this scope; a child's transitions among its own children are left alone.
    const entries = block.entries.map((e, i) => {
      if (!isRecord(e) || !inScope.has(edgeKey(block.path, i))) return e;
      const out = { ...e };
      if (out.source_node === from) { out.source_node = to; changed = true; }
      if (out.target_node === from) { out.target_node = to; changed = true; }
      return out;
    });
    if (changed) next = rewriteBlock(next, block.path, () => entries);
  }
  for (const sibling of graph.nodes) {
    const config = blockOf(sibling.section, "reset-config");
    if (!config) continue;
    const value = parseJsonBody(config);
    if (!isRecord(value)) continue;
    const out = { ...value };
    let changed = false;
    if (out.target_node === from) { out.target_node = to; changed = true; }
    if (Array.isArray(out.preserve_nodes) && out.preserve_nodes.includes(from)) { out.preserve_nodes = out.preserve_nodes.map(v => v === from ? to : v); changed = true; }
    if (changed) next = setBlock(next, sibling.path, "reset-config", JSON.stringify(out));
  }
  const attribute = node.section.attributes.id !== undefined || node.section.attributes.name === undefined ? "id" : "name";
  return setAttributes(next, node.path, { [attribute]: to });
}
/** Moves a node to be the first child node in its scope, which PSP treats as the usual entry point. */
export function makeEntry(doc: Document, scopePath: Path, key: string): Document {
  const nodes = childNodes(doc, scopePath);
  const node = nodes.find(n => n.key === key);
  if (!node || nodes[0]?.key === key) return doc;
  const removed = removeSection(doc, node.path);
  const first = childNodes(removed, scopePath)[0]!;
  return updateAt(removed, scopePath, c => ({ ...c, children: insertSection(c.children, node.section, scopePath.length, first.index) }));
}
export function parseJsonBody(section: Section | undefined): unknown {
  if (!section) return undefined;
  try { return JSON.parse(blockBody(section) || "null"); } catch { return undefined; }
}
export const uniqueKey = (taken: Iterable<string>, base: string): string => {
  const used = new Set(taken);
  for (let i = 1; ; i++) if (!used.has(`${base}_${i}`)) return `${base}_${i}`;
};

// ---------------------------------------------------------------- outline and checks

export interface OutlineItem { key: string; nodeType: string; scope: string[]; children: OutlineItem[] }
export function outline(doc: Document): OutlineItem[] {
  const walk = (path: Path, scope: string[]): OutlineItem[] => childNodes(doc, path).map(n => ({
    key: n.key, nodeType: n.nodeType, scope, children: walk(n.path, [...scope, n.key])
  }));
  return walk([], []);
}

export interface Check { level: "warn" | "info"; message: string; scope: string[]; node?: string; edge?: string }
/** Authoring hints. They flag structure the spec requires or references that do not resolve; they judge no conditions. */
export function checkDocument(doc: Document): Check[] {
  const checks: Check[] = [];
  const top = childNodes(doc, []);
  for (const app of top.filter(n => n.nodeType === "application")) {
    for (const attr of ["name", "session-id", "version"]) {
      if (!app.section.attributes[attr]) checks.push({ level: "warn", scope: [], node: app.key, message: `Application ${app.key} has no ${attr} attribute (PSP 8.2).` });
    }
  }
  const visit = (path: Path, scope: string[]) => {
    const graph = scopeGraph(doc, path);
    const seen = new Set<string>();
    for (const n of graph.nodes) {
      const topApp = path.length === 0 && n.nodeType === "application";
      if (!n.section.attributes.id && !topApp) checks.push({ level: "warn", scope, node: n.key, message: `A ${n.nodeType || "node"} in ${label(scope)} has no id.` });
      if (seen.has(n.key)) checks.push({ level: "warn", scope, node: n.key, message: `Two nodes in ${label(scope)} share the id ${n.key}.` });
      seen.add(n.key);
      if (!n.section.attributes.version && !topApp) checks.push({ level: "warn", scope, node: n.key, message: `${n.key} has no version (PSP 9.2).` });
      if (!n.nodeType) checks.push({ level: "warn", scope, node: n.key, message: `${n.key} has no node-type.` });
      const a = n.section.attributes;
      if (a["post-completion"] === "redirect" && !a["post-completion-target"]) checks.push({ level: "warn", scope, node: n.key, message: `${n.key} redirects after completion but has no post-completion-target (PSP 8.5).` });
      if (n.nodeType === "reset") {
        const config = parseJsonBody(blockOf(n.section, "reset-config"));
        const target = isRecord(config) ? config.target_node : undefined;
        if (typeof target !== "string" || !target) checks.push({ level: "warn", scope, node: n.key, message: `Reset node ${n.key} has no target_node.` });
        else if (!graph.nodes.some(m => m.key === target)) checks.push({ level: "warn", scope, node: n.key, message: `Reset node ${n.key} targets ${target}, which is not in ${label(scope)}.` });
      }
      if (n.section.children.some(c => isSection(c) && c.attributes.type === "system" && c.attributes.signature)) {
        checks.push({ level: "info", scope, node: n.key, message: `${n.key} carries a stored signature; edits to its instructions make it stale.` });
      }
      if (hasChildNodes(n.section)) visit(n.path, [...scope, n.key]);
    }
    for (const block of graph.blocks) {
      if (block.error) checks.push({ level: "warn", scope, ...(block.owner ? { node: block.owner } : {}), message: `${block.owner ?? label(scope)}: ${block.error}` });
      else block.entries!.forEach((e, i) => {
        if (!isRecord(e) || typeof e.target_node !== "string") checks.push({ level: "warn", scope, ...(block.owner ? { node: block.owner } : {}), message: `Transition ${i + 1} in ${block.owner ?? label(scope)} has no target_node.` });
      });
    }
    const keys = new Set(graph.nodes.map(n => n.key));
    for (const e of graph.edges) {
      if (!keys.has(e.target)) checks.push({ level: "warn", scope, edge: e.key, message: `${e.source} → ${e.target}: no node ${e.target} in ${label(scope)}.` });
      if (!keys.has(e.source)) checks.push({ level: "warn", scope, edge: e.key, message: `A transition leaves from ${e.source}, which is not in ${label(scope)}.` });
    }
    if (graph.entry && graph.edges.length) {
      const reached = new Set([graph.entry]), queue = [graph.entry];
      for (let q = 0; q < queue.length; q++) {
        for (const e of graph.edges) if (e.source === queue[q] && !reached.has(e.target)) { reached.add(e.target); queue.push(e.target); }
      }
      for (const n of graph.nodes) if (!reached.has(n.key)) checks.push({ level: "info", scope, node: n.key, message: `No transition from ${graph.entry} reaches ${n.key}.` });
    }
  };
  visit([], []);
  return checks;
}
const label = (scope: string[]) => scope.length ? scope[scope.length - 1]! : "the document";
