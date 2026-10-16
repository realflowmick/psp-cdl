// SPDX-License-Identifier: Apache-2.0
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseMarkup } from "@psp-cdl/core";
import {
  addNode, addTransition, blockBody, blockOf, checkDocument, childNodes, defaultScope, deleteNode, deleteTransition, escapeText, formatPsp,
  makeEntry, moveTransition, outline, parsePsp, patchTransition, renameNode, resolveScope, scopeGraph, setAttributes, setBlock, type Document
} from "../src/psp/model";
import { applicationTemplate, createNode, kindOf } from "../src/psp/kinds";
import { autoLayout, parseLayout, positionsFor, serializeLayout } from "../src/psp/layout";
import { SUPPORT_APP } from "./harness";
import { lineDiff, summarizeChanges } from "../src/psp/diff";

const load = (text = SUPPORT_APP): Document => { const r = parsePsp(text); if (!r.ok) throw new Error(r.error); return r.doc; };
const strip = (doc: Document) => JSON.parse(JSON.stringify({ ...doc, source: undefined, profile: undefined }));
/** Formatting must always produce text the reference codec reads back to the same tree. */
const roundTrips = (doc: Document) => expect(strip(parseMarkup(formatPsp(doc)))).toEqual(strip(doc));
const app: readonly number[] = [0];

describe("format", () => {
  it("is lossless for unchanged text and idempotent", () => {
    const doc = load();
    expect(formatPsp(doc)).toBe(SUPPORT_APP);
    roundTrips(doc);
    expect(formatPsp(load(formatPsp(doc)))).toBe(formatPsp(doc));
  });
  it("normalizes multi-line tags but keeps content, and escapes only what reads as markup", () => {
    const doc = load('${psp type=node\n   node-type="prompt" id=a version="1"}x${/psp}');
    expect(formatPsp(doc)).toBe('${psp type=node node-type=prompt id="a" version="1"}x${/psp}');
    for (const value of ["a\\b", "end\\", "\\\\", "literal ${psp type=x} and ${/psp}", '{"a":"x\\ny"}', "\\${psp"]) {
      const text = escapeText(value);
      expect(parseMarkup(text).children).toEqual([{ kind: "text", value }]);
    }
    expect(escapeText('{"a":"x\\ny"}')).toBe('{"a":"x\\ny"}');
  });
  it("reports parse errors with a line and column", () => {
    expect(parsePsp("${psp type=node}\n${psp type=system}x${/psp}")).toMatchObject({ ok: false, error: "UNCLOSED_SECTION" });
    expect(parsePsp("ok\n${/psp}")).toMatchObject({ ok: false, error: "UNEXPECTED_CLOSE", line: 2, column: 1 });
  });
});

describe("scope graph", () => {
  it("opens a single application at its own scope and reads its edges in order", () => {
    const doc = load();
    expect(defaultScope(doc)).toEqual(["support"]);
    expect(resolveScope(doc, ["support", "help"])).toEqual([0, 3]);
    const g = scopeGraph(doc, app);
    expect(g.nodes.map(n => n.key)).toEqual(["review", "help", "survey"]);
    expect(g.entry).toBe("review");
    expect(g.edges.map(e => [e.source, e.target, e.priority])).toEqual([["review", "help", 10], ["review", "survey", null], ["review", "survey", null]]);
    expect(g.missing).toEqual([]);
    expect(outline(doc)[0]!.children.map(c => [c.key, c.children.length])).toEqual([["review", 0], ["help", 1], ["survey", 0]]);
  });
  it("reads a node's own transitions as leaving from that node and flags missing targets", () => {
    const doc = load('${psp type=node node-type=composite id="c" version="1"}${psp type=node node-type=prompt id="a" version="1"}${psp type=transitions}[{"target_node":"b"},{"target_node":"gone"}]${/psp}${/psp}${psp type=node node-type=prompt id="b" version="1"/}${/psp}');
    const g = scopeGraph(doc, [0]);
    expect(g.edges.map(e => [e.owner, e.source, e.target])).toEqual([["a", "a", "b"], ["a", "a", "gone"]]);
    expect(g.missing).toEqual(["gone"]);
    expect(checkDocument(doc).map(c => c.message)).toContain("a → gone: no node gone in c.");
  });
});

describe("edits", () => {
  it("adds a node before the scope's transitions with matching indentation", () => {
    const doc = load();
    const { doc: next, path } = addNode(doc, app, createNode(kindOf("checkpoint"), "approve", 1));
    expect(childNodes(next, app).map(n => n.key)).toEqual(["review", "help", "survey", "approve"]);
    expect(path).toEqual([0, 7]);
    const text = formatPsp(next);
    expect(text).toContain('  ${/psp}\n  ${psp type=node node-type=checkpoint id="approve" version="v1.0.0"}\n    ${psp type=system version="v1.0.0"}Pause and wait for approval.${/psp}\n');
    expect(text.indexOf('id="approve"')).toBeLessThan(text.indexOf("type=transitions"));
    roundTrips(next);
  });
  it("adds transitions to the scope with source_node, or to a node that declares its own", () => {
    const doc = load();
    const { doc: next, key } = addTransition(doc, app, "help", "survey", { condition: "when clarified" });
    expect(key).toBe("0.7#3");
    expect(formatPsp(next)).toContain('    {"source_node":"help","target_node":"survey","condition":"when clarified"}\n  ]');
    const local = load('${psp type=node node-type=prompt id="a" version="1"}${psp type=transitions}[{"target_node":"b"}]${/psp}${/psp}${psp type=node node-type=prompt id="b" version="1"/}');
    const added = addTransition(local, [], "a", "a");
    expect(scopeGraph(added.doc, []).edges.map(e => [e.owner, e.target])).toEqual([["a", "b"], ["a", "a"]]);
    const fresh = addTransition(load('${psp type=node node-type=composite id="c" version="1"}\n  ${psp type=node node-type=prompt id="a" version="1" /}\n${/psp}'), [0], "a", "a");
    expect(formatPsp(fresh.doc)).toBe('${psp type=node node-type=composite id="c" version="1"}\n  ${psp type=node node-type=prompt id="a" version="1" /}\n  ${psp type=transitions content-type=json}\n  [\n    {"source_node":"a","target_node":"a"}\n  ]\n  ${/psp}\n${/psp}');
    roundTrips(fresh.doc);
    expect(() => addTransition(load('${psp type=node id="a" version="1"/}${psp type=transitions}{oops${/psp}'), [], "a", "a")).toThrow(/invalid transitions JSON/);
  });
  it("patches, reorders and deletes transitions while keeping unknown fields", () => {
    const doc = load('${psp type=node id="a" version="1"/}${psp type=node id="b" version="1"/}${psp type=transitions}[{"source_node":"a","target_node":"b","x-note":"keep"},{"source_node":"a","target_node":"a"}]${/psp}');
    let g = scopeGraph(doc, []);
    const patched = patchTransition(doc, g.edges[0]!, { condition: "score > 80", priority: 5 });
    expect(scopeGraph(patched, []).edges[0]!.entry).toEqual({ source_node: "a", target_node: "b", "x-note": "keep", condition: "score > 80", priority: 5 });
    g = scopeGraph(patched, []);
    const moved = moveTransition(patched, g, g.edges[1]!, -1);
    expect(scopeGraph(moved.doc, []).edges.map(e => e.target)).toEqual(["a", "b"]);
    expect(moved.key).toBe("2#0");
    const removed = deleteTransition(deleteTransition(moved.doc, { block: [2], index: 0 }), { block: [2], index: 0 });
    expect(formatPsp(removed)).toBe('${psp type=node id="a" version="1" /}${psp type=node id="b" version="1" /}');
  });
  it("renames a node with its in-scope references and deletes a node with its transitions", () => {
    const doc = load();
    const renamed = renameNode(doc, app, "survey", "feedback");
    const g = scopeGraph(renamed, app);
    expect(g.nodes.map(n => n.key)).toEqual(["review", "help", "feedback"]);
    expect(g.edges.map(e => e.target)).toEqual(["help", "feedback", "feedback"]);
    const reset = load('${psp type=node node-type=reset id="r" version="1"}${psp type=reset-config}{"target_node":"a","preserve_nodes":["a"]}${/psp}${/psp}${psp type=node id="a" version="1"/}');
    expect(blockBody(blockOf(childNodes(renameNode(reset, [], "a", "intake"), [])[0]!.section, "reset-config")!)).toBe('{"target_node":"intake","preserve_nodes":["intake"]}');
    const deleted = deleteNode(doc, app, "review");
    expect(childNodes(deleted, app).map(n => n.key)).toEqual(["help", "survey"]);
    expect(formatPsp(deleted)).not.toContain("type=transitions");
    roundTrips(deleted);
  });
  it("sets blocks and attributes, and moves a node to the entry position", () => {
    let doc = load();
    doc = setBlock(doc, [0, 5], "output-schema", '{"type":"object"}', { "content-type": "json" });
    doc = setBlock(doc, [0, 5], "system", "Ask for feedback.\nKeep it short.");
    doc = setAttributes(doc, [0, 5], { "transition-trust": "verified", version: undefined });
    const survey = childNodes(doc, app).find(n => n.key === "survey")!.section;
    expect(survey.attributes).toEqual({ type: "node", "node-type": "prompt", id: "survey", "transition-trust": "verified" });
    // Inline instructions that become multi-line move to block layout; the content itself is unchanged.
    expect(formatPsp({ kind: "document", children: [survey] })).toContain('${psp type=system version="v1.0.0"}\nAsk for feedback.\nKeep it short.\n    ${/psp}\n    ${psp type=output-schema content-type=json}{"type":"object"}${/psp}');
    const entry = makeEntry(doc, app, "survey");
    expect(scopeGraph(entry, app).entry).toBe("survey");
    roundTrips(entry);
  });
  it("builds a new application file that parses", () => {
    const doc = load(applicationTemplate("intake"));
    expect(defaultScope(doc)).toEqual(["intake"]);
    expect(checkDocument(doc).filter(c => c.level === "warn")).toEqual([]);
  });
});

describe("repository applications", () => {
  const root = resolve(__dirname, "../../..");
  it.each(["evaluation/campaign-application.psp", "examples/in-context/application.psp", "examples/in-context/validation/application.psp"])("%s formats losslessly and its transitions resolve", file => {
    const text = readFileSync(resolve(root, file), "utf8");
    const doc = load(text);
    // Opening and saving without edits leaves the author's text byte for byte.
    expect(formatPsp(doc)).toBe(text);
    roundTrips(doc);
    const scope = resolveScope(doc, defaultScope(doc))!;
    expect(scopeGraph(doc, scope).nodes.length).toBeGreaterThan(0);
    expect(checkDocument(doc).filter(c => c.level === "warn")).toEqual([]);
  });
});

describe("layout", () => {
  it("places nodes in columns by distance from the entry and round-trips the sidecar", () => {
    const p = autoLayout(["a", "b", "c", "d"], [{ source: "a", target: "b" }, { source: "a", target: "c" }]);
    expect(p.a!.x).toBe(0); expect(p.b!.x).toBe(300); expect(p.c!.x).toBe(300); expect(p.d!.x).toBe(600);
    const filled = positionsFor({ a: { x: 5, y: 5 } }, ["a", "z"], []);
    expect(filled).toEqual({ a: { x: 5, y: 5 }, z: { x: 0, y: 155 } });
    const text = serializeLayout({ s: { b: { x: 1.4, y: 2 }, a: { x: 0, y: 0 } }, empty: {} });
    expect(parseLayout(text)).toEqual({ s: { a: { x: 0, y: 0 }, b: { x: 1, y: 2 } } });
    expect(parseLayout("not json")).toEqual({});
  });
});

describe("change review", () => {
  it("summarizes added, removed and changed nodes and transitions by scope", () => {
    let after = setBlock(load(), [0, 5], "system", "Ask for feedback in one question.");
    after = addNode(after, [0], createNode(kindOf("reset"), "again", 1)).doc;
    after = deleteNode(after, resolveScope(after, ["support", "help"])!, "clarify");
    after = addTransition(after, [0], "survey", "again").doc;
    const s = summarizeChanges(SUPPORT_APP, formatPsp(after));
    expect(s.parsed).toBe(true);
    expect(s.nodes.added).toEqual([{ scope: ["support"], key: "again", nodeType: "reset" }]);
    expect(s.nodes.removed).toEqual([{ scope: ["support", "help"], key: "clarify", nodeType: "prompt" }]);
    expect(s.nodes.changed).toEqual([{ scope: ["support"], key: "survey", nodeType: "prompt" }]);
    expect(s.transitions.added).toEqual([{ scope: ["support"], source: "survey", target: "again", condition: null }]);
    expect(s.transitions.removed).toEqual([]);
    const created = summarizeChanges(null, SUPPORT_APP);
    expect(created.nodes.added.map(n => n.key)).toEqual(["support", "review", "help", "clarify", "survey"]);
    expect(summarizeChanges("${psp", SUPPORT_APP).parsed).toBe(false);
  });
  it("diffs lines with removals before additions and folds long unchanged runs", () => {
    const before = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`).join("\n");
    const after = before.replace("line 10", "line ten").replace("line 20", "line 20\nline 21");
    const rows = lineDiff(before, after);
    expect(rows.filter(r => r.kind !== "same" && r.kind !== "skip")).toEqual([
      { kind: "del", text: "line 10", left: 10, right: null }, { kind: "add", text: "line ten", left: null, right: 10 },
      { kind: "add", text: "line 21", left: null, right: 21 }
    ]);
    expect(rows[0]).toEqual({ kind: "skip", count: 6 });
    // Lines 11 to 20 are unchanged between the two edits: three kept on each side, four folded.
    expect(rows.some(r => r.kind === "skip" && r.count === 4)).toBe(true);
    expect(lineDiff("a\nb", "a\nb")).toEqual([{ kind: "skip", count: 2 }]);
  });
});
