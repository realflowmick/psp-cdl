// SPDX-License-Identifier: Apache-2.0
/** Node cryptography adapter. Codec/root entry point remains free of Node imports. */
import { createHmac, createPrivateKey, createPublicKey, sign, verify, timingSafeEqual } from "node:crypto";
import { PspError, record, validateJson } from "./json.js";
import { decodeSignature, encodeSignature, envelopeFromObject, signatureInput, validateTime, type Envelope, type Signature } from "./signatures.js";
import { documentToObject, type Document } from "./markup.js";

export interface TrustedKey {
  id: string; algorithm: Signature["algorithm"]; material: Uint8Array; status: "active" | "revoked";
  trustLevels: readonly number[]; sectionTypes: readonly string[]; scope: Record<string, string>; allowUnscoped: boolean;
}
export interface VerificationPolicy { keys: readonly TrustedKey[]; now: number; context: Record<string, string>; allowedAttributes: readonly string[]; clockSkew?: number }
function edKey(raw: Uint8Array, privateKey: boolean) {
  if (!(raw instanceof Uint8Array) || raw.length !== 32) throw new PspError("INVALID_KEY");
  const bytes = Buffer.concat([Buffer.from(privateKey ? "302e020100300506032b657004220420" : "302a300506032b6570032100", "hex"), raw]);
  return privateKey ? createPrivateKey({key:bytes, format:"der", type:"pkcs8"}) : createPublicKey({key:bytes, format:"der", type:"spki"});
}
function secret(raw: Uint8Array): Uint8Array {
  if (!(raw instanceof Uint8Array) || raw.length < 32) throw new PspError("INVALID_KEY", "HMAC keys must contain at least 32 bytes.");
  return raw;
}
export function signEnvelope(data: unknown, metadata: Omit<Signature, "value">, privateKey: Uint8Array): Envelope {
  const value = encodeSignature(new Uint8Array(metadata.algorithm === "ed25519" ? 64 : 32));
  const e = envelopeFromObject({signature:{...metadata, value}, data});
  if (validateTime(e.signature.timestamp, e.signature.expires, e.signature.timestamp) !== "valid") throw new PspError("INVALID_TIME");
  const bytes = signatureInput(e);
  e.signature.value = encodeSignature(e.signature.algorithm === "ed25519" ? sign(null, bytes, edKey(privateKey, true)) : createHmac("sha256", secret(privateKey)).update(bytes).digest());
  return e;
}
export function signDocument(document:Document, metadata:Omit<Signature,"value"|"contentType">, privateKey:Uint8Array, preserveSource=true):Envelope {
  return signEnvelope(documentToObject(document,preserveSource),{...metadata,contentType:"json"},privateKey);
}
/** Crypto only. Use verifyEnvelope to additionally require key authority, scope and time. */
export function verifySignature(input: Envelope, publicKeyOrSecret: Uint8Array): boolean {
  const e = envelopeFromObject(input), bytes = signatureInput(e), signature = decodeSignature(e.signature.value, e.signature.algorithm);
  return e.signature.algorithm === "ed25519" ? verify(null, bytes, edKey(publicKeyOrSecret, false), signature)
    : timingSafeEqual(createHmac("sha256", secret(publicKeyOrSecret)).update(bytes).digest(), signature);
}
/** Requires host-owned policy. A returned envelope does not authorize a tool call. */
export function verifyEnvelope(input: Envelope, policy: VerificationPolicy): Envelope {
  const e = envelopeFromObject(input), s = e.signature;
  if (!record(policy) || !Array.isArray(policy.keys) || !Array.isArray(policy.allowedAttributes) || !record(policy.context)) throw new PspError("INVALID_POLICY");
  validateJson(policy.context);
  if (Object.values(policy.context).some(v => typeof v !== "string") || policy.allowedAttributes.some(a => typeof a !== "string")) throw new PspError("INVALID_POLICY");
  if(policy.keys.some(k=>!record(k)||typeof k.id!=="string")) throw new PspError("INVALID_POLICY");
  const matches = policy.keys.filter(k => k.id === (s.kid ?? s.secretId));
  if (matches.length !== 1) throw new PspError(matches.length ? "INVALID_POLICY" : "UNKNOWN_KEY");
  const key = matches[0]!;
  if (key.status !== "active") throw new PspError("REVOKED_KEY");
  if (key.algorithm !== s.algorithm) throw new PspError("KEY_ALGORITHM_MISMATCH");
  if (!verifySignature(e, key.material)) throw new PspError("INVALID_SIGNATURE");
  const time = validateTime(s.timestamp, s.expires, policy.now, Object.hasOwn(policy,"clockSkew")?policy.clockSkew!:0);
  if (time !== "valid") throw new PspError(time === "invalid" ? "INVALID_TIME" : time.toUpperCase());
  if (!Array.isArray(key.trustLevels) || key.trustLevels.some((v:unknown)=>typeof v!=="number"||!Number.isInteger(v)||v<0||v>5) || !Array.isArray(key.sectionTypes) || key.sectionTypes.some((v:unknown)=>typeof v!=="string") || !record(key.scope) || typeof key.allowUnscoped !== "boolean") throw new PspError("INVALID_POLICY");
  if (!key.trustLevels.includes(s.trustLevel ?? 2) || !key.sectionTypes.includes(s.sectionType)) throw new PspError("UNAUTHORIZED_KEY");
  const attrs = s.attributes ?? {};
  if (Object.keys(attrs).some(k => !policy.allowedAttributes.includes(k))) throw new PspError("UNSUPPORTED_ATTRIBUTE");
  for (const [k,v] of Object.entries(key.scope)) if (typeof v !== "string" || policy.context[k] !== v) throw new PspError("SCOPE_MISMATCH");
  for (const [k,v] of Object.entries(policy.context)) {
    if (Object.hasOwn(attrs, k) ? attrs[k] !== v : !key.allowUnscoped) throw new PspError("SCOPE_MISMATCH");
  }
  if (!key.allowUnscoped && !Object.keys(policy.context).length) throw new PspError("SCOPE_MISMATCH");
  return e;
}
