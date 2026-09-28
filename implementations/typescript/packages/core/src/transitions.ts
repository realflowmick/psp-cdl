// SPDX-License-Identifier: Apache-2.0
import { PspError, byteLength, canonicalJson, parseJson, record, validateJson } from "./json.js";

export const TRANSITION_PROFILE = "PSP-TRANSITIONS-0.1";
type Scalar = string | number | boolean | null;
type Expression = { kind: "literal"; value: Scalar } | { kind: "fact"; path: string } |
  { kind: "operator"; op: string; left: Expression; right?: Expression };
type Token = { kind: "literal"; value: Scalar } | { kind: "fact" | "symbol"; value: string };
export interface TransitionSelection {
  profile: typeof TRANSITION_PROFILE;
  transitionIndex: number;
  sourceNode: string;
  targetNode: string;
  usedFacts: string[];
}
const fail = (code: string): never => { throw new PspError(code); };
const own = (v: Record<string, unknown>, k: string) => Object.hasOwn(v, k);
const id = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z_][A-Za-z0-9_-]{0,127}$/.test(v) && !/[\r\n]/.test(v);
const path = (v: string) => v.length <= 256 && /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*$/.test(v) &&
  !/[\r\n]/.test(v) && v.split(".").length <= 16 && !v.split(".").some(x => ["__proto__", "prototype", "constructor"].includes(x));
const scalar = (v: unknown): v is Scalar => v === null || ["string", "number", "boolean"].includes(typeof v);
const exact = (v: Record<string, unknown>, required: string[], optional: string[] = []) =>
  required.every(k => own(v, k)) && Object.keys(v).every(k => required.includes(k) || optional.includes(k));

function tokenize(source: string): Token[] {
  if (byteLength(source) > 4096) fail("TRANSITION_LIMIT_EXCEEDED");
  const tokens: Token[] = [];
  let i = 0;
  while (i < source.length) {
    const c = source[i]!;
    if (/[ \t\r\n]/.test(c)) { i++; continue; }
    if (tokens.length >= 512) fail("TRANSITION_LIMIT_EXCEEDED");
    if (c === '"' || c === "'") {
      const start = i++, quote = c;
      let value = "", closed = false;
      while (i < source.length) {
        const next = source[i++]!;
        if (next === quote) { closed = true; break; }
        if (next === "\\") {
          const escaped = source[i++];
          if (escaped === undefined) fail("UNSUPPORTED_CONDITION");
          if (quote === "'" && escaped !== "'" && escaped !== "\\") fail("UNSUPPORTED_CONDITION");
          value += escaped;
        } else {
          if (next.charCodeAt(0) < 32) fail("UNSUPPORTED_CONDITION");
          value += next;
        }
      }
      if (!closed) fail("UNSUPPORTED_CONDITION");
      if (quote === '"') {
        try { value = parseJson(source.slice(start, i)) as string; }
        catch { fail("UNSUPPORTED_CONDITION"); }
      }
      tokens.push({ kind: "literal", value }); continue;
    }
    const rest = source.slice(i);
    const number = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/.exec(rest);
    if (number) {
      let value: Scalar;
      try { value = parseJson(number[0]) as number; } catch { return fail("UNSUPPORTED_CONDITION"); }
      tokens.push({ kind: "literal", value }); i += number[0].length; continue;
    }
    const word = /^[A-Za-z_][A-Za-z0-9_.]*/.exec(rest);
    if (word) {
      const value = word[0]; i += value.length;
      if (["true", "false", "null"].includes(value)) tokens.push({ kind: "literal", value: value === "null" ? null : value === "true" });
      else if (["AND", "OR", "NOT"].includes(value)) tokens.push({ kind: "symbol", value });
      else { if (!path(value)) fail("UNSUPPORTED_CONDITION"); tokens.push({ kind: "fact", value }); }
      continue;
    }
    const symbol = /^(?:==|!=|<=|>=|[<>()])/.exec(rest);
    if (!symbol) fail("UNSUPPORTED_CONDITION");
    tokens.push({ kind: "symbol", value: symbol![0] }); i += symbol![0].length;
  }
  return tokens;
}

function compile(source: string): { expression: Expression; references: string[] } {
  const tokens = tokenize(source), references = new Set<string>();
  let i = 0;
  const accept = (op: string) => {
    if (tokens[i]?.kind === "symbol" && tokens[i]!.value === op) { i++; return true; }
    return false;
  };
  const primary = (depth: number): Expression => {
    if (depth > 32) return fail("TRANSITION_LIMIT_EXCEEDED");
    if (accept("NOT")) return { kind: "operator", op: "NOT", left: primary(depth + 1) };
    if (accept("(")) {
      const result = or(depth + 1);
      if (!accept(")")) fail("UNSUPPORTED_CONDITION");
      return result;
    }
    const token = tokens[i++];
    if (token?.kind === "literal") return { kind: "literal", value: token.value };
    if (token?.kind === "fact") { references.add(token.value); return { kind: "fact", path: token.value }; }
    return fail("UNSUPPORTED_CONDITION");
  };
  const compare = (depth: number): Expression => {
    const left = primary(depth), op = tokens[i];
    if (op?.kind === "symbol" && ["==", "!=", "<", "<=", ">", ">="].includes(op.value)) {
      i++; return { kind: "operator", op: op.value, left, right: primary(depth) };
    }
    return left;
  };
  const and = (depth: number): Expression => {
    let left = compare(depth);
    while (accept("AND")) left = { kind: "operator", op: "AND", left, right: compare(depth) };
    return left;
  };
  const or = (depth: number): Expression => {
    let left = and(depth);
    while (accept("OR")) left = { kind: "operator", op: "OR", left, right: and(depth) };
    return left;
  };
  const expression = or(0);
  if (i !== tokens.length) fail("UNSUPPORTED_CONDITION");
  return { expression, references: [...references].sort() };
}

function evaluate(expression: Expression, values: Map<string, Scalar>): Scalar {
  if (expression.kind === "literal") return expression.value;
  if (expression.kind === "fact") return values.get(expression.path)!;
  const a = evaluate(expression.left, values);
  if (expression.op === "NOT") { if (typeof a !== "boolean") fail("INVALID_CONDITION_TYPE"); return !a; }
  const b = evaluate(expression.right!, values);
  if (["AND", "OR"].includes(expression.op)) {
    if (typeof a !== "boolean" || typeof b !== "boolean") fail("INVALID_CONDITION_TYPE");
    return expression.op === "AND" ? a && b : a || b;
  }
  if (["==", "!="].includes(expression.op)) return expression.op === "==" ? a === b : a !== b;
  if (typeof a !== "number" || typeof b !== "number") return fail("INVALID_CONDITION_TYPE");
  switch (expression.op) { case "<": return a < b; case "<=": return a <= b; case ">": return a > b; default: return a >= b; }
}

function endpoint(value: unknown, pattern = false): string[] {
  if (typeof value !== "string" || value.length > 2048 || /[^\x21-\x7e]|[?#]/.test(value)) return fail("INVALID_TRANSITION_REQUEST");
  const match = /^([A-Za-z][A-Za-z0-9+.-]*):\/\/([^/*]+)\/([^*]+|\*)$/.exec(value);
  if (!match || !pattern && match[3] === "*") return fail("INVALID_TRANSITION_REQUEST");
  return [match[1]!.toLowerCase(), match[2]!, match[3]!];
}
function constraints(attributes: Record<string, unknown>) {
  const names = ["transition-trust", "transition-endpoints", "transition-max-trust-level", "transition-min-priority", "transition-require-signature"];
  if (Object.entries(attributes).some(([k, v]) => typeof v !== "string" || k.startsWith("transition-") && !names.includes(k))) fail("INVALID_TRANSITION_REQUEST");
  const presets: Record<string, [number, number, boolean]> = {
    "governance-only": [2, 70, true], verified: [3, 50, false], "include-user": [4, 30, false], permissive: [5, 0, false]
  };
  const preset = own(attributes, "transition-trust") ? attributes["transition-trust"] as string : "verified";
  if (!own(presets, preset)) fail("INVALID_TRANSITION_REQUEST");
  let [trust, priority, signed] = presets[preset]!;
  const integer = (key: string, fallback: number, max: number) => {
    if (!own(attributes, key)) return fallback;
    const value = attributes[key] as string;
    if (!/^(0|[1-9][0-9]*)$/.test(value) || /[^0-9]/.test(value) || Number(value) > max) fail("INVALID_TRANSITION_REQUEST");
    return Number(value);
  };
  trust = integer("transition-max-trust-level", trust, 5);
  priority = integer("transition-min-priority", priority, 100);
  if (own(attributes, "transition-require-signature")) {
    const v = attributes["transition-require-signature"];
    if (v !== "true" && v !== "false") fail("INVALID_TRANSITION_REQUEST");
    signed = v === "true";
  }
  let endpoints: string[][] | null = null;
  if (own(attributes, "transition-endpoints")) {
    const text = attributes["transition-endpoints"] as string;
    endpoints = text === "" ? [] : text.split(",").map(x => endpoint(x.replace(/^[ \t\r\n]+|[ \t\r\n]+$/g, ""), true));
    if (endpoints.length > 1024) fail("TRANSITION_LIMIT_EXCEEDED");
  }
  return { trust, priority, signed, endpoints };
}

/** Internal static validation shared with application compilation; no facts are evaluated. */
export function prepareTransitionDefinitions(nodeId: string, siblings: unknown[], transitions: unknown[]) {
  return transitions.map((edge, index) => {
    if (!record(edge) || !exact(edge, ["target_node"], ["source_node", "condition", "priority"]) || !id(edge.target_node) ||
        own(edge, "source_node") && !id(edge.source_node) || own(edge, "condition") && typeof edge.condition !== "string" ||
        own(edge, "priority") && !Number.isSafeInteger(edge.priority)) return fail("INVALID_TRANSITION_REQUEST");
    const source = (own(edge, "source_node") ? edge.source_node : nodeId) as string;
    if (!siblings.includes(source) || !siblings.includes(edge.target_node)) fail("TRANSITION_SCOPE_VIOLATION");
    return { index, source, target: edge.target_node, priority: (edge.priority ?? 0) as number, ...compile((edge.condition ?? "true") as string) };
  });
}
/** Internal control validation; callers must first admit ordinary JSON attributes. */
export function validateTransitionControls(attributes: Record<string, unknown>): void { constraints(attributes); }

/** Host-only selection. Provenance must be authenticated out of band; selection does not authorize a commit. */
export function selectTransition(value: unknown): TransitionSelection {
  const input = validateJson(value);
  if (byteLength(canonicalJson(input)) > 1_048_576) fail("TRANSITION_LIMIT_EXCEEDED");
  if (!record(input) || !exact(input, ["profile", "nodeId", "completed", "siblings", "attributes", "transitions", "facts"]) ||
      input.profile !== TRANSITION_PROFILE || !id(input.nodeId) || typeof input.completed !== "boolean" ||
      !Array.isArray(input.siblings) || !record(input.attributes) || !Array.isArray(input.transitions) || !record(input.facts)) return fail("INVALID_TRANSITION_REQUEST");
  const { nodeId, siblings, transitions, facts } = input;
  if (siblings.length > 1024 || transitions.length > 256 || Object.keys(facts).length > 1024) fail("TRANSITION_LIMIT_EXCEEDED");
  if (!siblings.length || siblings.some(x => !id(x)) || new Set(siblings).size !== siblings.length || !siblings.includes(nodeId)) fail("INVALID_TRANSITION_REQUEST");
  const policy = constraints(input.attributes);
  const admitted = new Map<string, { value: unknown; qualified: boolean }>();
  for (const [name, fact] of Object.entries(facts)) {
    if (!path(name) || !record(fact) || !exact(fact, ["value", "origins"]) || !Array.isArray(fact.origins) || !fact.origins.length) fail("INVALID_TRANSITION_REQUEST");
    const f = fact as { value: unknown; origins: Record<string, unknown>[] };
    if (f.origins.length > 32) fail("TRANSITION_LIMIT_EXCEEDED");
    let qualified = true;
    for (const origin of f.origins) {
      if (!record(origin) || !exact(origin, ["endpoint", "trustLevel", "priority", "signatureVerified"]) ||
          !Number.isInteger(origin.trustLevel) || (origin.trustLevel as number) < 0 || (origin.trustLevel as number) > 5 ||
          !Number.isInteger(origin.priority) || (origin.priority as number) < 0 || (origin.priority as number) > 100 || typeof origin.signatureVerified !== "boolean") fail("INVALID_TRANSITION_REQUEST");
      const uri = endpoint(origin.endpoint);
      qualified = qualified && (origin.trustLevel as number) <= policy.trust && (origin.priority as number) >= policy.priority &&
        (!policy.signed || origin.signatureVerified === true) && (policy.endpoints === null || policy.endpoints.some(p => p[0] === uri[0] && p[1] === uri[1] && (p[2] === "*" || p[2] === uri[2])));
    }
    admitted.set(name, { value: f.value, qualified });
  }
  const compiled = prepareTransitionDefinitions(nodeId, siblings, transitions);
  if (!input.completed) fail("NODE_INCOMPLETE");
  compiled.sort((a, b) => b.priority - a.priority || a.index - b.index);
  for (const edge of compiled) {
    if (edge.source !== nodeId) continue;
    const values = new Map<string, Scalar>();
    for (const name of edge.references) {
      const fact = admitted.get(name);
      if (!fact?.qualified) fail("INSUFFICIENT_QUALIFIED_DATA");
      if (!scalar(fact!.value)) fail("INVALID_CONDITION_TYPE");
      values.set(name, fact!.value as Scalar);
    }
    const result = evaluate(edge.expression, values);
    if (typeof result !== "boolean") fail("INVALID_CONDITION_TYPE");
    if (result) return { profile: TRANSITION_PROFILE, transitionIndex: edge.index, sourceNode: nodeId, targetNode: edge.target, usedFacts: edge.references };
  }
  return fail("NO_TRANSITION");
}
