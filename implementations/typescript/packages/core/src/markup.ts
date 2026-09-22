// SPDX-License-Identifier: Apache-2.0
import { PspError, byteLength, canonicalJson, parseJson, put, record, unicode, validateJson } from "./json.js";

export interface TextNode { kind: "text"; value: string }
export interface Section { kind: "section"; attributes: Record<string, string>; children: PspNode[] }
export type PspNode = TextNode | Section;
export interface Document { kind: "document"; profile?: "PSP-CODEC-1.0"; children: PspNode[]; source?: string }
export const CODEC_PROFILE = "PSP-CODEC-1.0";
export const MARKUP_LIMITS = Object.freeze({ maxBytes: 4_194_304, maxDepth: 64, maxNodes: 10_000, maxAttributes: 256, maxAttributeBytes: 65_536 });
const name = /^[A-Za-z_][A-Za-z0-9_.:-]*$/;
const white = (c: string | undefined) => c !== undefined && /^[\t\n\r ]$/.test(c);
const opening = (s: string, i: number) => s.startsWith("${psp", i) && (i + 5 === s.length || white(s[i + 5]) || s[i + 5] === "}" || s[i + 5] === "/");
const closing = (s: string, i: number) => s.startsWith("${/psp", i);
function append(nodes: PspNode[], text: string): void {
  if (!text) return;
  const last = nodes.at(-1);
  if (last?.kind === "text") last.value += text; else nodes.push({kind:"text", value:text});
}
/** No I/O, template interpolation, schema execution or trust promotion occurs here. */
export function parseMarkup(source: string): Document {
  if (typeof source !== "string") throw new PspError("INVALID_MARKUP");
  unicode(source); if (byteLength(source) > MARKUP_LIMITS.maxBytes) throw new PspError("LIMIT_EXCEEDED");
  const document: Document = {kind:"document", profile:CODEC_PROFILE, children:[], source};
  const stack: (Document | Section)[] = [document];
  let i = 0, nodes = 0, text = "";
  const fail = (code = "INVALID_MARKUP"): never => { throw new PspError(code, code, byteLength(source.slice(0, i))); };
  const flush = () => { if (text) { append(stack.at(-1)!.children, text); text = ""; if (++nodes > MARKUP_LIMITS.maxNodes) fail("LIMIT_EXCEEDED"); } };
  while (i < source.length) {
    if (source[i] === "\\" && (source[i + 1] === "\\" || source.startsWith("${psp", i + 1) || closing(source, i + 1))) {
      if (source[i + 1] === "\\") { text += "\\"; i += 2; }
      else { text += "$"; i += 2; }
      continue;
    }
    if (closing(source, i)) {
      flush(); if (!source.startsWith("${/psp}", i) || stack.length === 1) fail("UNEXPECTED_CLOSE");
      stack.pop(); i += 7; continue;
    }
    if (!opening(source, i)) { text += source[i++]; continue; }
    flush(); i += 5;
    const attributes: Record<string, string> = {};
    let selfClosing = false;
    while (true) {
      const spaced = white(source[i]); while (white(source[i])) i++;
      if (source[i] === "}") { i++; break; }
      if (source.startsWith("/}", i)) { i += 2; selfClosing = true; break; }
      if (!spaced) fail();
      const key = /^[A-Za-z_][A-Za-z0-9_.:-]*/.exec(source.slice(i))?.[0];
      if (!key) fail(); i += key!.length;
      if (Object.hasOwn(attributes, key!)) fail("DUPLICATE_ATTRIBUTE");
      if (source[i++] !== "=") fail();
      let value: string;
      if (source[i] === '"') {
        const start = i++;
        let ended = false;
        while (i < source.length) {
          const c = source[i++];
          if (c === '"') { ended = true; break; }
          if (c === "\\") i++;
        }
        if (!ended) fail();
        const decoded = parseJson(source.slice(start, i));
        if (typeof decoded !== "string") fail(); value = decoded as string;
      } else {
        const token = /^[A-Za-z0-9_.-]+/.exec(source.slice(i))?.[0];
        if (!token) fail(); value = token!; i += value.length;
      }
      if (byteLength(value) > MARKUP_LIMITS.maxAttributeBytes || Object.keys(attributes).length >= MARKUP_LIMITS.maxAttributes) fail("LIMIT_EXCEEDED");
      put(attributes, key!, value);
    }
    if (!Object.hasOwn(attributes, "type") || !/^[a-z][a-z0-9-]*$/.test(attributes.type!) || /[^a-z0-9-]/.test(attributes.type!)) fail("INVALID_SECTION_TYPE");
    if (++nodes > MARKUP_LIMITS.maxNodes || stack.length > MARKUP_LIMITS.maxDepth) fail("LIMIT_EXCEEDED");
    const section: Section = {kind:"section", attributes, children:[]};
    stack.at(-1)!.children.push(section); if (!selfClosing) stack.push(section);
  }
  flush(); if (stack.length !== 1) fail("UNCLOSED_SECTION");
  return document;
}
/** Validate and detach ordinary language objects, retaining an optional source hint. */
export function documentFromObject(input: unknown): Document {
  const data = validateJson(input);
  if (!record(data) || data.kind !== "document" || !Array.isArray(data.children) || Object.keys(data).some(k => !["kind", "profile", "children", "source"].includes(k))) throw new PspError("INVALID_DOCUMENT");
  if (Object.hasOwn(data,"profile") && data.profile !== CODEC_PROFILE) throw new PspError("UNSUPPORTED_PROFILE");
  let count = 0;
  function children(values: unknown[], depth: number): PspNode[] {
    if (depth > MARKUP_LIMITS.maxDepth) throw new PspError("LIMIT_EXCEEDED");
    const result: PspNode[] = [];
    for (const value of values) {
      if (++count > MARKUP_LIMITS.maxNodes) throw new PspError("LIMIT_EXCEEDED");
      if (!record(value)) throw new PspError("INVALID_DOCUMENT");
      if (value.kind === "text" && typeof value.value === "string" && Object.keys(value).length === 2) { append(result, value.value); continue; }
      if (value.kind !== "section" || !record(value.attributes) || !Array.isArray(value.children) || Object.keys(value).some(k => !["kind", "attributes", "children"].includes(k))) throw new PspError("INVALID_DOCUMENT");
      const attributes: Record<string, string> = {};
      if (Object.keys(value.attributes).length > MARKUP_LIMITS.maxAttributes) throw new PspError("LIMIT_EXCEEDED");
      for (const [key, v] of Object.entries(value.attributes)) {
        if (name.exec(key)?.[0] !== key || typeof v !== "string") throw new PspError("INVALID_ATTRIBUTE");
        if (byteLength(v) > MARKUP_LIMITS.maxAttributeBytes) throw new PspError("LIMIT_EXCEEDED");
        put(attributes, key, v);
      }
      if (!Object.hasOwn(attributes, "type") || !/^[a-z][a-z0-9-]*$/.test(attributes.type!) || /[^a-z0-9-]/.test(attributes.type!)) throw new PspError("INVALID_SECTION_TYPE");
      result.push({kind:"section", attributes, children:children(value.children, depth + 1)});
    }
    return result;
  }
  const result: Document = {kind:"document", profile:CODEC_PROFILE, children:children(data.children, 0)};
  if (Object.hasOwn(data, "source")) {
    if (typeof data.source !== "string") throw new PspError("INVALID_DOCUMENT");
    result.source = data.source;
  }
  return result;
}
export function documentToObject(document: Document, preserveSource = true): Document {
  const result = documentFromObject(document); if (!preserveSource) delete result.source; return result;
}
export function documentToJson(document: Document, preserveSource = true): string { return canonicalJson(documentToObject(document, preserveSource)); }
export function documentFromJson(source: string): Document { return documentFromObject(parseJson(source)); }
export function serializeMarkup(input: Document, mode: "preserve" | "canonical" = "preserve"): string {
  if (!["preserve", "canonical"].includes(mode)) throw new PspError("INVALID_OPTION");
  const document = documentFromObject(input);
  if (mode === "preserve" && document.source !== undefined) {
    try {
      if (canonicalJson(documentToObject(parseMarkup(document.source), false)) === canonicalJson(documentToObject(document, false))) return document.source;
    } catch (error) { if (!(error instanceof PspError)) throw error; }
  }
  const emit = (node: PspNode): string => {
    if (node.kind === "text") return node.value.replace(/\\/g, "\\\\").replace(/\$\{\/?psp/g, "\\$&");
    const attributes = Object.keys(node.attributes).sort().map(k => k + "=" + JSON.stringify(node.attributes[k])).join(" ");
    return node.children.length ? "${psp " + attributes + "}" + node.children.map(emit).join("") + "${/psp}" : "${psp " + attributes + " /}";
  };
  const output = document.children.map(emit).join("");
  if (byteLength(output) > MARKUP_LIMITS.maxBytes) throw new PspError("LIMIT_EXCEEDED");
  return output;
}
