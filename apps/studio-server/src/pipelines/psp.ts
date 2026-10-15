// SPDX-License-Identifier: Apache-2.0
/**
 * Reads a referenced PSP for display: sections, signature state and the CDL declarations on its
 * CONTEXT payloads. Nothing here edits, signs or interprets the document; that is the PSP editor's
 * job and, at run time, the model's.
 */
import { parseMarkup, sectionToEnvelope, type Section } from "@psp-cdl/core";
import { verifySignature } from "@psp-cdl/core/crypto";
import { isPspxPath, type PspNodeInfo, type PspResolution, type PspSection, type PspSummary, type SignatureState } from "@psp-cdl/studio-core";
import { ed25519PublicKey, type Vault } from "../secrets/vault.js";
import type { Workspace } from "../workspace/files.js";
import { unpack } from "../psp/files.js";

export interface ResolvedPointer { pointer: string; source: PspSummary["source"]; path: string }

/** `env:NAME` reads a workspace path from the server's environment; `prompt:<name>` is `prompts/<name>.md`. */
export function resolvePointer(pointer: string, workspace: Workspace, env: NodeJS.ProcessEnv = process.env): ResolvedPointer | { pointer: string; reason: string } {
  let source: PspSummary["source"] = "path", path = pointer.trim();
  if (path.startsWith("env:")) {
    const name = path.slice(4);
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) return { pointer, reason: `${name} is not an environment variable name.` };
    const value = env[name];
    if (!value) return { pointer, reason: `${name} is not set on the studio server.` };
    source = "env"; path = value.trim();
  } else if (path.startsWith("prompt:")) {
    const name = path.slice(7);
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(name)) return { pointer, reason: "A prompt name is letters, digits, dot, dash or underscore." };
    source = "prompt"; path = `prompts/${name}.md`;
  }
  path = path.replace(/^(repo|workspace):\/\//, "");
  if (source !== "prompt" && !/\.pspx?$/i.test(path)) return { pointer, reason: `${path} is not a .psp or .pspx file.` };
  try { workspace.resolve(path); } catch (e) { return { pointer, reason: (e as Error).message }; }
  if (!workspace.exists(path)) return { pointer, reason: `${path} does not exist in the workspace.` };
  return { pointer, source, path };
}

const words = (value: unknown): string[] => (Array.isArray(value) ? value : typeof value === "string" ? value.split(/[\s,]+/) : [])
  .filter((t): t is string => typeof t === "string" && t.length > 0 && !t.startsWith("!"));
const isSection = (n: unknown): n is Section => !!n && typeof n === "object" && (n as Section).kind === "section";
const bodyText = (s: Section): string => s.children.map(c => c.kind === "text" ? c.value : "").join("");

function signatureState(section: Section, vault: Vault, now: number): { state: SignatureState; algorithm?: string; expires?: string } {
  const a = section.attributes;
  if (!a.signature) return { state: "missing" };
  const expires = /^\d+$/.test(a.expires ?? "") ? Number(a.expires) : null;
  const out = { ...(a["signature-algorithm"] ? { algorithm: a["signature-algorithm"] } : {}), ...(expires !== null ? { expires: new Date(expires * 1000).toISOString() } : {}) };
  if (expires !== null && expires <= now) return { state: "expired", ...out };
  const key = vault.signingKey();
  const keyId = a.kid ?? a["secret-id"];
  if (!key || key.keyId !== keyId || key.algorithm !== a["signature-algorithm"]) return { state: "unverified", ...out };
  try {
    const material = key.algorithm === "ed25519" ? ed25519PublicKey(key.material) : key.material;
    return { state: verifySignature(sectionToEnvelope(section), material) ? "valid" : "invalid", ...out };
  } catch { return { state: "invalid", ...out }; }
}

/** Walks the document for SYSTEM and CONTEXT sections and nodes; CONTEXT JSON payloads carry `x-cdl-*` declarations. */
export function summarizeText(resolved: ResolvedPointer, text: string, format: PspSummary["format"], vault: Vault, now = Math.floor(Date.now() / 1000)): PspSummary {
  const base: PspSummary = { pointer: resolved.pointer, path: resolved.path, source: resolved.source, format, parses: true, signed: false, sections: [], nodes: [], entryNode: null, covenants: [], classes: [] };
  if (format === "prompt") return { ...base, sections: [{ type: "system", ref: resolved.path, signature: "missing", classes: [], covenants: [], bytes: Buffer.byteLength(text) }] };
  let doc;
  try { doc = parseMarkup(text); }
  catch (e) { return { ...base, parses: false, error: (e as Error).message }; }
  const sections: PspSection[] = [], nodes: PspNodeInfo[] = [];
  const walk = (children: unknown[], node: string | undefined) => {
    for (const child of children) {
      if (!isSection(child)) continue;
      const a = child.attributes, type = a.type;
      if (type === "node") {
        if (a.id && a.version) nodes.push({ id: a.id, version: a.version, agents: (a.agents ?? "").split(",").map(s => s.trim()).filter(Boolean) });
        walk(child.children, a.id ?? a.name ?? node);
        continue;
      }
      if (type === "system" || type === "context") {
        const body = bodyText(child), sig = signatureState(child, vault, now);
        let classes: string[] = [], covenants: string[] = [];
        if (type === "context" && a["content-type"] === "json") {
          try {
            const payload = JSON.parse(body) as Record<string, unknown>;
            if (payload && typeof payload === "object" && !Array.isArray(payload)) { classes = words(payload["x-cdl-classes"]); covenants = words(payload["x-cdl-covenants"]); }
          } catch { /* An unparsable payload declares nothing. */ }
        }
        const ref = type === "system" ? node : a.name ?? a.id ?? a.source;
        sections.push({ type, ...(ref ? { ref } : {}), signature: sig.state, ...(sig.algorithm ? { algorithm: sig.algorithm } : {}), ...(sig.expires ? { expires: sig.expires } : {}), classes, covenants, bytes: Buffer.byteLength(body) });
        continue;
      }
      walk(child.children, node);
    }
  };
  walk(doc.children, undefined);
  const covenants = [...new Set(sections.flatMap(s => s.covenants))], classes = [...new Set(sections.flatMap(s => s.classes))];
  const system = sections.filter(s => s.type === "system");
  return { ...base, sections, nodes, entryNode: nodes[0] ?? null, covenants, classes, signed: system.length > 0 && system.every(s => s.signature === "valid") };
}

export interface LoadedPsp { resolved: ResolvedPointer; summary: PspSummary; application: string; system: string | null }
/** Resolves and reads a pointer. A .pspx contributes its application part; its system part is kept for the prompt. */
export function loadPsp(pointer: string, workspace: Workspace, vault: Vault, env: NodeJS.ProcessEnv = process.env): { status: "resolved"; loaded: LoadedPsp } | { status: "unresolved"; pointer: string; reason: string } {
  const resolved = resolvePointer(pointer, workspace, env);
  if (!("path" in resolved)) return { status: "unresolved", pointer, reason: resolved.reason };
  let raw: string;
  try { raw = workspace.read(resolved.path).text.replace(/\r\n?/g, "\n"); } catch (e) { return { status: "unresolved", pointer, reason: (e as Error).message }; }
  if (resolved.source === "prompt") return { status: "resolved", loaded: { resolved, summary: summarizeText(resolved, raw, "prompt", vault), application: raw, system: null } };
  if (isPspxPath(resolved.path)) {
    try {
      const parts = unpack(raw);
      return { status: "resolved", loaded: { resolved, summary: summarizeText(resolved, parts.application, "pspx", vault), application: parts.application, system: parts.system } };
    } catch (e) {
      const summary: PspSummary = { pointer, path: resolved.path, source: resolved.source, format: "pspx", parses: false, error: (e as Error).message, signed: false, sections: [], nodes: [], entryNode: null, covenants: [], classes: [] };
      return { status: "resolved", loaded: { resolved, summary, application: "", system: null } };
    }
  }
  return { status: "resolved", loaded: { resolved, summary: summarizeText(resolved, raw, "psp", vault), application: raw, system: null } };
}
export function pspResolution(pointer: string, workspace: Workspace, vault: Vault, env?: NodeJS.ProcessEnv): PspResolution {
  const r = loadPsp(pointer, workspace, vault, env);
  return r.status === "resolved" ? { status: "resolved", summary: r.loaded.summary } : r;
}
