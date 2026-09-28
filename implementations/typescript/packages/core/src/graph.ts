// SPDX-License-Identifier: Apache-2.0
import {PspError, byteLength, canonicalJson, parseJson, record, validateJson} from "./json.js";
import {documentFromObject, type Section} from "./markup.js";
import {canonicalVersion} from "./signatures.js";
import {TRANSITION_PROFILE, selectTransition, prepareTransitionDefinitions, validateTransitionControls} from "./transitions.js";

export const APPLICATION_GRAPH_PROFILE = "PSP-APPLICATION-GRAPH-0.1";
export interface GraphNode {
  path: string; parentPath: string | null; id: string | null; nodeType: string; version: string;
  attributes: Record<string, string>; children: string[]; entryPath: string | null;
  text: string[]; sections: Section[]; transitions: Record<string, unknown>[];
}
export interface GraphDescription {
  profile: typeof APPLICATION_GRAPH_PROFILE; rootPath: "/"; entryPath: string;
  executionSupported: false; nodes: GraphNode[];
}
export interface GraphSelection {
  profile: typeof APPLICATION_GRAPH_PROFILE; sourcePath: string; targetPath: string;
  transitionIndex: number; usedFacts: string[];
}
export interface CompiledApplication {
  describe(): GraphDescription;
  select(path: string, completed: boolean, facts: unknown): GraphSelection;
}
const fail = (code: string): never => { throw new PspError(code); };
const id = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z_][A-Za-z0-9_-]{0,127}$/.test(value) && !/[\r\n]/.test(value);
const white = (value: string) => !/[^ \t\r\n]/.test(value);
const childPath = (parent: string, child: string) => (parent === "/" ? "/" : parent + "/") + child;
const containers = new Set(["application", "composite", "loop"]);
const nodeTypes = new Set([...containers, "prompt", "connector", "checkpoint", "reset"]);
const single = new Set(["system", "transitions", "output-schema", "workflow-state", "output", "input", "settings",
  "threat-policy", "post-completion", "connector-config", "checkpoint-config", "loop-config", "reset-config"]);
const sectionTypes = new Set([...single, "context", "user", "custom", "machine", "link", "checkpoint-input"]);

function inspectBlock(section: Section): void {
  const type = section.attributes.type!;
  if (type === "node") fail("MISPLACED_GRAPH_NODE");
  if (!sectionTypes.has(type)) fail("UNSUPPORTED_GRAPH_SECTION");
  if (type === "system") canonicalVersion(section.attributes.version!);
  for (const child of section.children) if (child.kind === "section") inspectBlock(child);
}
function transitionBody(section: Section): Record<string, unknown>[] {
  if (section.attributes["content-type"] !== undefined && section.attributes["content-type"] !== "json") fail("UNSUPPORTED_GRAPH_SECTION");
  if (section.children.some(c => c.kind !== "text")) fail("INVALID_GRAPH_TRANSITIONS");
  const value = parseJson(section.children.map(c => c.kind === "text" ? c.value : "").join(""));
  if (!Array.isArray(value)) return fail("INVALID_GRAPH_TRANSITIONS");
  if (value.length > 256) fail("GRAPH_LIMIT_EXCEEDED");
  if (value.some(v => !record(v))) fail("INVALID_GRAPH_TRANSITIONS");
  return value as Record<string, unknown>[];
}

/** Compile structure only. Document signatures and live execution authority remain host-owned. */
export function compileApplication(value: unknown): CompiledApplication {
  const input = validateJson(value);
  if (!record(input) || input.profile !== APPLICATION_GRAPH_PROFILE || !Object.hasOwn(input, "document") ||
      Object.keys(input).some(k => !["profile", "document", "entries"].includes(k)) ||
      Object.hasOwn(input, "entries") && !record(input.entries)) return fail("INVALID_GRAPH_REQUEST");
  if (byteLength(canonicalJson(input)) > 4_194_304) fail("GRAPH_LIMIT_EXCEEDED");
  const document = documentFromObject(input.document);
  const roots = document.children.filter(c => c.kind === "section");
  if (roots.length !== 1 || document.children.some(c => c.kind === "text" && !white(c.value)) ||
      roots[0]!.attributes.type !== "node" || roots[0]!.attributes["node-type"] !== "application") fail("INVALID_APPLICATION_ROOT");
  const nodes: GraphNode[] = [], byPath = new Map<string, GraphNode>();
  const blocks = new Map<string, Record<string, unknown>[]>();
  function visit(section: Section, parent: string | null, depth: number): GraphNode {
    if (depth > 32 || nodes.length >= 1024) return fail("GRAPH_LIMIT_EXCEEDED");
    const attributes = section.attributes, type = attributes["node-type"]!;
    if (!nodeTypes.has(type)) fail("UNSUPPORTED_NODE_TYPE");
    if (parent !== null && !id(attributes.id) || Object.hasOwn(attributes, "id") && !id(attributes.id)) fail("INVALID_GRAPH_NODE_ID");
    const localId = attributes.id ?? null, path = parent === null ? "/" : childPath(parent, localId!);
    if (byPath.has(path)) fail("DUPLICATE_GRAPH_NODE");
    const version = canonicalVersion(attributes.version!);
    if (attributes.load !== undefined && !["eager", "lazy"].includes(attributes.load)) fail("INVALID_GRAPH_ATTRIBUTE");
    if (type === "application") {
      for (const k of ["name", "session-id"]) {
        const text = attributes[k];
        if (text === undefined || white(text) || byteLength(text) > 256) fail("INVALID_APPLICATION_ATTRIBUTE");
      }
      if (attributes.mode !== undefined && !["dev", "debug", "demo", "prod"].includes(attributes.mode)) fail("INVALID_APPLICATION_ATTRIBUTE");
      if (attributes["post-completion"] !== undefined && !["unmanaged", "lockdown", "scoped", "redirect"].includes(attributes["post-completion"])) fail("INVALID_APPLICATION_ATTRIBUTE");
      if (attributes["post-completion"] === "redirect" && (!attributes["post-completion-target"] || white(attributes["post-completion-target"]))) fail("INVALID_APPLICATION_ATTRIBUTE");
    }
    validateTransitionControls(attributes);
    const node: GraphNode = {path, parentPath: parent, id: localId, nodeType: type, version, attributes,
      children: [], entryPath: null, text: [], sections: [], transitions: []};
    nodes.push(node); byPath.set(path, node);
    const seen = new Set<string>(), children: Section[] = [];
    for (const child of section.children) {
      if (child.kind === "text") { node.text.push(child.value); continue; }
      const kind = child.attributes.type!;
      if (kind === "node") { children.push(child); continue; }
      inspectBlock(child);
      if (single.has(kind) && seen.has(kind)) fail("DUPLICATE_GRAPH_SECTION");
      seen.add(kind);
      if (kind === "post-completion") {
        if (type !== "application") fail("MISPLACED_GRAPH_SECTION");
        const nested = child.children.filter(c => c.kind === "section");
        if (child.children.some(c => c.kind === "text" && !white(c.value)) || nested.filter(c => c.attributes.type === "system").length !== 1 ||
            nested.filter(c => c.attributes.type === "threat-policy").length > 1 || nested.some(c => !["system", "threat-policy"].includes(c.attributes.type!))) fail("INVALID_POST_COMPLETION_SECTION");
      }
      if (kind === "transitions") blocks.set(path, transitionBody(child));
      else node.sections.push(child);
    }
    if (attributes["post-completion"] === "scoped" && !seen.has("post-completion")) fail("INVALID_POST_COMPLETION_SECTION");
    if (containers.has(type) !== (children.length > 0)) fail("INVALID_GRAPH_CHILDREN");
    for (const child of children) node.children.push(visit(child, path, depth + 1).path);
    node.entryPath = node.children[0] ?? null;
    return node;
  }
  visit(roots[0]!, null, 1);
  const entries = (input.entries ?? {}) as Record<string, unknown>;
  for (const [path, localId] of Object.entries(entries)) {
    const node = byPath.get(path);
    if (!node || !id(localId) || !node.children.includes(childPath(path, localId))) fail("INVALID_GRAPH_ENTRY");
    node!.entryPath = childPath(path, localId as string);
  }
  // Pre-order makes parent-declared edges precede a child's own block, even if
  // the parent block appears after its child sections in the source document.
  for (const declaring of nodes) {
    for (const edge of blocks.get(declaring.path) ?? []) {
      let source: GraphNode | undefined;
      if (containers.has(declaring.nodeType) && Object.hasOwn(edge, "source_node")) {
        if (!id(edge.source_node)) fail("INVALID_GRAPH_TRANSITIONS");
        const path = childPath(declaring.path, edge.source_node as string);
        if (!declaring.children.includes(path)) fail("TRANSITION_SCOPE_VIOLATION");
        source = byPath.get(path);
      } else {
        source = declaring;
        if (declaring.parentPath === null) fail("AMBIGUOUS_GRAPH_TRANSITION");
        if (Object.hasOwn(edge, "source_node") && edge.source_node !== declaring.id) fail("TRANSITION_SCOPE_VIOLATION");
      }
      source!.transitions.push({...edge, source_node: source!.id});
      if (source!.transitions.length > 256) fail("GRAPH_LIMIT_EXCEEDED");
    }
  }
  for (const node of nodes) if (node.parentPath !== null) {
    const siblings = byPath.get(node.parentPath)!.children.map(path => byPath.get(path)!.id!);
    prepareTransitionDefinitions(node.id!, siblings, node.transitions);
  }
  const description: GraphDescription = {profile: APPLICATION_GRAPH_PROFILE, rootPath: "/", entryPath: nodes[0]!.entryPath!, executionSupported: false, nodes};
  if (byteLength(canonicalJson(description)) > 8_388_608) fail("GRAPH_LIMIT_EXCEEDED");
  return Object.freeze({
    describe: () => validateJson(description) as unknown as GraphDescription,
    select(path: string, completed: boolean, facts: unknown): GraphSelection {
      const node = typeof path === "string" ? byPath.get(path) : undefined;
      if (!node || node.parentPath === null) return fail("INVALID_GRAPH_PATH");
      const siblings = byPath.get(node.parentPath)!.children.map(p => byPath.get(p)!.id!);
      const result = selectTransition({profile: TRANSITION_PROFILE, nodeId: node.id, completed, siblings, attributes: node.attributes, transitions: node.transitions, facts});
      return {profile: APPLICATION_GRAPH_PROFILE, sourcePath: path, targetPath: childPath(node.parentPath, result.targetNode), transitionIndex: result.transitionIndex, usedFacts: result.usedFacts};
    }
  });
}
