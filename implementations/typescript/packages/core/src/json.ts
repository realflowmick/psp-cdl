// SPDX-License-Identifier: Apache-2.0
import canonicalize from "canonicalize";

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export class PspError extends Error {
  constructor(public readonly code: string, message = code, public readonly offset?: number) { super(message); this.name = "PspError"; }
}
export const JSON_LIMITS = Object.freeze({ maxBytes: 4_194_304, maxDepth: 256, maxValues: 100_000 });
export type JsonLimits = typeof JSON_LIMITS;
export function unicode(value: string): void {
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const d = value.charCodeAt(++i);
      if (!(d >= 0xdc00 && d <= 0xdfff)) throw new PspError("INVALID_UNICODE");
    } else if (c >= 0xdc00 && c <= 0xdfff) throw new PspError("INVALID_UNICODE");
  }
}
export function byteLength(value: string): number { return new TextEncoder().encode(value).length; }
export function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
}
export function put<T>(target: Record<string, T>, key: string, value: T): void {
  Object.defineProperty(target, key, { value, enumerable: true, writable: true, configurable: true });
}
export function validateJson(value: unknown): JsonValue {
  let count = 0, bytes = 0;
  const seen = new Set<object>();
  function visit(v: unknown, depth: number): JsonValue {
    if (depth > JSON_LIMITS.maxDepth || ++count > JSON_LIMITS.maxValues) throw new PspError("LIMIT_EXCEEDED");
    if (v === null || typeof v === "boolean") return v;
    if (typeof v === "string") { unicode(v); bytes += byteLength(v); if (bytes > JSON_LIMITS.maxBytes) throw new PspError("LIMIT_EXCEEDED"); return v; }
    if (typeof v === "number") {
      if (!Number.isFinite(v) || (Number.isInteger(v) && !Number.isSafeInteger(v))) throw new PspError("INVALID_NUMBER");
      return Object.is(v, -0) ? 0 : v;
    }
    if (typeof v !== "object" || (!Array.isArray(v) && !record(v))) throw new PspError("INVALID_JSON_VALUE");
    if (seen.has(v)) throw new PspError("CYCLIC_VALUE");
    seen.add(v);
    let result: JsonValue;
    if (Array.isArray(v)) {
      if (Object.keys(v).length !== v.length || Object.getOwnPropertySymbols(v).length) throw new PspError("INVALID_JSON_VALUE");
      result = Array.from({length:v.length}, (_, i) => {
        const d = Object.getOwnPropertyDescriptor(v, String(i));
        if (!d || !Object.hasOwn(d, "value")) throw new PspError("INVALID_JSON_VALUE");
        return visit(d.value, depth + 1);
      });
    } else {
      const out: Record<string, JsonValue> = {};
      if (Object.getOwnPropertySymbols(v).length) throw new PspError("INVALID_JSON_VALUE");
      for (const key of Object.getOwnPropertyNames(v)) {
        unicode(key); bytes += byteLength(key); if (bytes > JSON_LIMITS.maxBytes) throw new PspError("LIMIT_EXCEEDED");
        const d = Object.getOwnPropertyDescriptor(v, key)!;
        if (!d.enumerable || !Object.hasOwn(d, "value")) throw new PspError("INVALID_JSON_VALUE");
        put(out, key, visit(d.value, depth + 1));
      }
      result = out;
    }
    seen.delete(v); return result;
  }
  return visit(value, 0);
}

/** Parse JSON without discarding duplicate names or overflowing integer tokens. */
export function parseJson(source: string): JsonValue {
  if (typeof source !== "string") throw new PspError("INVALID_JSON");
  unicode(source);
  if (byteLength(source) > JSON_LIMITS.maxBytes) throw new PspError("LIMIT_EXCEEDED");
  let i = 0, count = 0;
  const fail = (code = "INVALID_JSON"): never => { throw new PspError(code, code, byteLength(source.slice(0, i))); };
  const ws = () => { while (/[\t\n\r ]/.test(source[i] ?? "x")) i++; };
  function string(): string {
    const start = i++;
    while (i < source.length) {
      const c = source[i++];
      if (c === '"') {
        let result: string;
        try { result = JSON.parse(source.slice(start, i)); } catch { return fail(); }
        unicode(result); return result;
      }
      if (c === "\\") i++;
    }
    return fail();
  }
  function value(depth: number): JsonValue {
    if (depth > JSON_LIMITS.maxDepth || ++count > JSON_LIMITS.maxValues) return fail("LIMIT_EXCEEDED");
    ws(); const c = source[i];
    if (c === '"') return string();
    if (c === "{" || c === "[") {
      i++; ws();
      const object = c === "{", end = object ? "}" : "]";
      const out: Record<string, JsonValue> = {}, arr: JsonValue[] = [];
      if (source[i] === end) { i++; return object ? out : arr; }
      while (i < source.length) {
        ws();
        if (object) {
          if (source[i] !== '"') return fail();
          const key = string();
          if (Object.hasOwn(out, key)) return fail("DUPLICATE_KEY");
          ws(); if (source[i++] !== ":") return fail();
          put(out, key, value(depth + 1));
        } else arr.push(value(depth + 1));
        ws(); if (source[i] === end) { i++; return object ? out : arr; }
        if (source[i++] !== ",") return fail();
      }
      return fail();
    }
    for (const [literal, parsed] of [["true", true], ["false", false], ["null", null]] as const) {
      if (source.startsWith(literal, i)) { i += literal.length; return parsed; }
    }
    const token = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/.exec(source.slice(i))?.[0];
    if (!token) return fail();
    i += token.length; const number = Number(token);
    if (!Number.isFinite(number) || (Number.isInteger(number) && !Number.isSafeInteger(number))) return fail("INVALID_NUMBER");
    return Object.is(number, -0) ? 0 : number;
  }
  const result = value(0); ws(); if (i !== source.length) fail(); return result;
}
/** RFC 8785, with the profile's Unicode and safe-integer admission checks. */
export function canonicalJson(value: unknown): string {
  const output=canonicalize(validateJson(value))!;
  if(byteLength(output)>JSON_LIMITS.maxBytes) throw new PspError("LIMIT_EXCEEDED");
  return output;
}
