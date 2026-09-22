// SPDX-License-Identifier: Apache-2.0
import { PspError, canonicalJson, parseJson, put, record, validateJson, type JsonValue } from "./json.js";
import { documentFromObject, documentToObject, type Document, type Section } from "./markup.js";

export interface Signature {
  value: string; algorithm: "ed25519" | "hmac-sha256"; signatureVersion: "2.0";
  timestamp: number; expires: number; version: string; sectionType: string; contentType: "text" | "json";
  kid?: string; secretId?: string; trustLevel?: number; priority?: number; attributes?: Record<string, string>;
}
export interface Envelope { signature: Signature; data: JsonValue }
export const SIGNATURE_PROFILE = "PSP-SIGNATURE-2.0";
const map: Record<string, keyof Signature> = {signature:"value", "signature-algorithm":"algorithm", "signature-version":"signatureVersion", kid:"kid", "secret-id":"secretId", timestamp:"timestamp", expires:"expires", version:"version", "trust-level":"trustLevel", priority:"priority", type:"sectionType", "content-type":"contentType"};
const reserved = new Set([...Object.keys(map), ...Object.values(map), "attributes"]);
const semver = /^v?(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-((?:0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;
const integer = (v: unknown, min: number, max: number) => typeof v === "number" && Number.isSafeInteger(v) && v >= min && v <= max;
export function canonicalVersion(value: string): string {
  if (typeof value !== "string" || semver.exec(value)?.[0] !== value) throw new PspError("INVALID_VERSION");
  return value.replace(/^v/, "");
}
/** Structural/profile validation and detached objects; no cryptographic trust claim. */
export function envelopeFromObject(input: unknown): Envelope {
  const e = validateJson(input);
  if (!record(e)) throw new PspError("INVALID_ENVELOPE");
  const alias = Object.hasOwn(e, "x-signature"), sk = alias ? "x-signature" : "signature", dk = alias ? "x-data" : "data";
  if (Object.keys(e).length !== 2 || !Object.hasOwn(e, sk) || !Object.hasOwn(e, dk) || !record(e[sk])) throw new PspError("INVALID_ENVELOPE");
  const s = e[sk] as Record<string, unknown>;
  if (Object.keys(s).some(k => !new Set([...Object.values(map), "attributes"]).has(k))) throw new PspError("INVALID_ENVELOPE");
  if (s.signatureVersion !== "2.0") throw new PspError("UNSUPPORTED_PROFILE");
  if (typeof s.algorithm!=="string" || !["ed25519", "hmac-sha256"].includes(s.algorithm)) throw new PspError("UNSUPPORTED_ALGORITHM");
  if (typeof s.value !== "string" || !s.value || /[^A-Za-z0-9_-]/.test(s.value)) throw new PspError("INVALID_ENCODING");
  const key = s.algorithm === "ed25519" ? "kid" : "secretId", forbidden = key === "kid" ? "secretId" : "kid";
  if (typeof s[key] !== "string" || !(s[key] as string).length || Object.hasOwn(s, forbidden)) throw new PspError("INVALID_ENVELOPE");
  if (!integer(s.timestamp, 0, Number.MAX_SAFE_INTEGER) || !integer(s.expires, 0, Number.MAX_SAFE_INTEGER)) throw new PspError("INVALID_TIME");
  canonicalVersion(s.version as string);
  if (typeof s.sectionType !== "string" || !/^[a-z][a-z0-9-]*$/.test(s.sectionType) || /[^a-z0-9-]/.test(s.sectionType)) throw new PspError("INVALID_SECTION_TYPE");
  if (Object.hasOwn(s, "trustLevel") && !integer(s.trustLevel, 0, 5)) throw new PspError("INVALID_TRUST_LEVEL");
  if (Object.hasOwn(s, "priority") && (typeof s.priority !== "number" || !Number.isFinite(s.priority) || s.priority < 0 || s.priority > 100)) throw new PspError("INVALID_PRIORITY");
  if (Object.hasOwn(s, "attributes")) {
    if (!record(s.attributes) || Object.entries(s.attributes).some(([k, v]) => reserved.has(k) || typeof v !== "string")) throw new PspError("INVALID_ATTRIBUTE");
  }
  if (s.contentType === "text") { if (typeof e[dk] !== "string") throw new PspError("INVALID_CONTENT"); }
  else if (s.contentType !== "json" || (!record(e[dk]) && !Array.isArray(e[dk]))) throw new PspError("INVALID_CONTENT");
  return {signature:s as unknown as Signature, data:e[dk] as JsonValue};
}
export function parseEnvelope(source: string): Envelope { return envelopeFromObject(parseJson(source)); }
export function serializeEnvelope(input: Envelope, aliases = false): string {
  const e = envelopeFromObject(input); return canonicalJson(aliases ? {"x-signature":e.signature, "x-data":e.data} : e);
}
export function protectedContent(input: Envelope): string {
  const {signature:s, data:original} = envelopeFromObject(input);
  const metadata: Record<string, unknown> = {};
  for (const [k,v] of Object.entries(s)) if (!["value", "timestamp", "version"].includes(k)) put(metadata, k, v);
  metadata.trustLevel ??= 2; metadata.priority ??= 50; metadata.attributes ??= {};
  const data = s.contentType === "text" ? (original as string).replace(/\r\n?/g, "\n").replace(/^[\t\n ]+|[\t\n ]+$/g, "") : original;
  return canonicalJson({data, metadata});
}
export function signatureInput(input: Envelope): Uint8Array {
  const e = envelopeFromObject(input);
  return new TextEncoder().encode(protectedContent(e) + "|" + e.signature.timestamp + "|" + canonicalVersion(e.signature.version));
}
export function encodeSignature(bytes: Uint8Array): string {
  return btoa(Array.from(bytes, b => String.fromCharCode(b)).join("")).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
export function decodeSignature(value: string, algorithm: Signature["algorithm"]): Uint8Array {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]+$/.test(value) || !["ed25519", "hmac-sha256"].includes(algorithm)) throw new PspError("INVALID_ENCODING");
  let bytes: Uint8Array;
  try { bytes = Uint8Array.from(atob(value.replace(/-/g, "+").replace(/_/g, "/")), c => c.charCodeAt(0)); }
  catch { throw new PspError("INVALID_ENCODING"); }
  if (bytes.length !== (algorithm === "ed25519" ? 64 : 32) || encodeSignature(bytes) !== value) throw new PspError("INVALID_ENCODING");
  return bytes;
}
export function validateTime(timestamp: unknown, expires: unknown, now: number, skew = 0): "valid" | "invalid" | "expired" | "not_yet_valid" {
  if (!integer(timestamp, 0, Number.MAX_SAFE_INTEGER) || !integer(expires, 0, Number.MAX_SAFE_INTEGER) || (expires as number) <= (timestamp as number) || !integer(skew, 0, 300) || typeof now !== "number" || !Number.isFinite(now) || Math.abs(now)>Number.MAX_SAFE_INTEGER) return "invalid";
  if (now >= (expires as number)) return "expired";
  return now < (timestamp as number) - skew ? "not_yet_valid" : "valid";
}
export function sectionToEnvelope(input: Section): Envelope {
  const section = documentFromObject({kind:"document", children:[input]}).children[0] as Section;
  if(!section || section.kind!=="section") throw new PspError("INVALID_SECTION_TYPE");
  if (section.children.some(c => c.kind !== "text")) throw new PspError("NESTED_ENVELOPE_CONVERSION", "Use the document-object transport for nested markup; flattening changes its interpretation.");
  const s: Record<string, unknown> = {}, attributes: Record<string, string> = {};
  for (const [key, value] of Object.entries(section.attributes)) {
    if (Object.hasOwn(map, key)) {
      const target = map[key]!;
      if (["timestamp", "expires", "trustLevel"].includes(target)) {
        if (!/^(0|[1-9][0-9]*)$/.test(value) || /[^0-9]/.test(value)) throw new PspError("INVALID_NUMBER");
        put(s, target, parseJson(value));
      } else if (target === "priority") put(s, target, parseJson(value));
      else put(s, target, value);
    } else put(attributes, key, value);
  }
  if (Object.keys(attributes).length) s.attributes = attributes;
  const body = section.children.map(c => (c as {value:string}).value).join("");
  return envelopeFromObject({signature:s, data:s.contentType === "json" ? parseJson(body) : body});
}
export function envelopeToSection(input: Envelope): Section {
  const e = envelopeFromObject(input), attributes: Record<string, string> = {};
  for (const [key, field] of Object.entries(map)) if (Object.hasOwn(e.signature, field)) put(attributes, key, String(e.signature[field]));
  for (const [key, value] of Object.entries(e.signature.attributes ?? {})) put(attributes, key, value);
  const body = e.signature.contentType === "text" ? e.data as string : canonicalJson(e.data);
  return documentFromObject({kind:"document", children:[{kind:"section", attributes, children:body ? [{kind:"text", value:body}] : []}]}).children[0] as Section;
}
/** Whole nested documents use a JSON tree envelope rather than lossy text flattening. */
export function documentEnvelopeData(document:Document, preserveSource=true):JsonValue {
  return validateJson(documentToObject(document,preserveSource));
}
export function envelopeToDocument(input:Envelope):Document {
  const e=envelopeFromObject(input); if(e.signature.contentType!=="json") throw new PspError("INVALID_CONTENT");
  return documentFromObject(e.data);
}
