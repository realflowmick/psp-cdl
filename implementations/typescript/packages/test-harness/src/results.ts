// SPDX-License-Identifier: Apache-2.0
/** Archival result signatures. Host-owned trust and artifact bytes are always required. */
import { createHash, createPrivateKey, createPublicKey, sign, verify } from 'node:crypto';
import { canonicalJson, parseJson, record } from '@psp-cdl/core';

const DOMAIN = 'PSP-CDL-RESULT-MANIFEST-0.1\n';
const PROFILE = 'result-ed25519-0.1';
const MAX_FILE_BYTES = 4_194_304;
const REQUIRED = ['analysis.json', 'bundle.json', 'corpus.json', 'grading.json', 'manifest.json', 'outcomes.json'];
const PATH = /^(?:(?:analysis|bundle|corpus|grading|manifest|outcomes|operator-admission)\.json|[0-9]{4}\.(?:(?:record|started|timing|observation)\.json|events\.jsonl))(?![\s\S])/;
const DIGEST = /^[a-f0-9]{64}(?![\s\S])/;
const KEY_ID = /^[a-z0-9][a-z0-9._-]{0,127}(?![\s\S])/;
export interface ResultArtifact { path: string; bytes: number; sha256: string }
export interface ResultManifest {
  schemaVersion: 1; scope: 'signed-result-manifest-0.1';
  bundleSha256: string; planSha256: string; corpusSha256: string;
  mode: 'offline' | 'live'; status: 'finalized' | 'invalid-source-changed'; recovered: boolean;
  evidencePolicy: 'local-synthetic-raw-0.1'; fullStudy: false; independentReview: false; executionAuthorized: false;
  artifacts: ResultArtifact[];
}
export interface SignedResultManifest {
  manifest: ResultManifest;
  signature: { profile: 'result-ed25519-0.1'; algorithm: 'ed25519'; keyId: string; signedAt: number; value: string };
}
export interface ResultVerificationPolicy {
  keyId: string; publicKey: Uint8Array; status: 'active' | 'revoked'; bundleSha256: string; now: number;
}
export class ResultManifestError extends Error {
  constructor(public readonly code: string) { super(code); this.name = 'ResultManifestError'; }
}
function requireValue(value: unknown, code: string): asserts value { if (!value) throw new ResultManifestError(code); }
function exact(value: unknown, keys: string[]): value is Record<string, any> {
  return record(value) && Object.keys(value).length === keys.length && keys.every(k => Object.hasOwn(value, k));
}
function copy(value: unknown): any {
  try { return parseJson(canonicalJson(value)); } catch { throw new ResultManifestError('INVALID_RESULT_MANIFEST'); }
}
const digest = (value: unknown): value is string => typeof value === 'string' && DIGEST.test(value);
const integer = (v: unknown, max = Number.MAX_SAFE_INTEGER): boolean => Number.isSafeInteger(v) && Number(v) >= 0 && Number(v) <= max;
const hash = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
const objectHash = (value: unknown): string => hash(Buffer.from(canonicalJson(value), 'utf8'));
function bytes(value: unknown, length: number, code: string): asserts value is Uint8Array {
  requireValue(value instanceof Uint8Array && value.length === length, code);
}

export function validateResultManifest(value: unknown): ResultManifest {
  const m = copy(value);
  requireValue(exact(m, ['schemaVersion','scope','bundleSha256','planSha256','corpusSha256','mode','status','recovered',
    'evidencePolicy','fullStudy','independentReview','executionAuthorized','artifacts']), 'INVALID_RESULT_MANIFEST');
  requireValue(m.schemaVersion === 1 && m.scope === 'signed-result-manifest-0.1' &&
    ['bundleSha256','planSha256','corpusSha256'].every(k => digest(m[k])) && ['offline','live'].includes(m.mode) &&
    ['finalized','invalid-source-changed'].includes(m.status) && typeof m.recovered === 'boolean' &&
    m.evidencePolicy === 'local-synthetic-raw-0.1' && m.fullStudy === false && m.independentReview === false &&
    m.executionAuthorized === false && Array.isArray(m.artifacts) && m.artifacts.length >= 6 && m.artifacts.length <= 25001,
    'INVALID_RESULT_MANIFEST');
  let previous = '';
  for (const f of m.artifacts) {
    requireValue(exact(f, ['path','bytes','sha256']) && typeof f.path === 'string' && PATH.test(f.path) &&
      f.path > previous && integer(f.bytes, MAX_FILE_BYTES) && digest(f.sha256), 'INVALID_ARTIFACT_INVENTORY');
    previous = f.path;
  }
  const paths = new Set(m.artifacts.map((f: ResultArtifact) => f.path));
  requireValue(REQUIRED.every(p => paths.has(p)) && paths.has('operator-admission.json') === (m.mode === 'live'), 'INVALID_ARTIFACT_INVENTORY');
  return m as ResultManifest;
}

function envelope(value: unknown): SignedResultManifest {
  const e = copy(value);
  requireValue(exact(e, ['manifest','signature']) && exact(e.signature, ['profile','algorithm','keyId','signedAt','value']), 'INVALID_RESULT_MANIFEST');
  e.manifest = validateResultManifest(e.manifest);
  const s = e.signature;
  requireValue(s.profile === PROFILE && s.algorithm === 'ed25519', 'UNSUPPORTED_RESULT_SIGNATURE');
  requireValue(typeof s.keyId === 'string' && KEY_ID.test(s.keyId) && integer(s.signedAt), 'INVALID_RESULT_SIGNATURE');
  requireValue(typeof s.value === 'string' && /^[A-Za-z0-9_-]{86}(?![\s\S])/.test(s.value), 'INVALID_RESULT_SIGNATURE');
  const raw = Buffer.from(s.value, 'base64url');
  requireValue(raw.length === 64 && raw.toString('base64url') === s.value, 'INVALID_RESULT_SIGNATURE');
  return e as SignedResultManifest;
}
/** Domain separation plus JCS of every field except the signature value. No PSP signature-format change. */
export function resultSigningInput(value: unknown): Uint8Array {
  const e = envelope(value), { value: _value, ...signature } = e.signature;
  return Buffer.from(DOMAIN + canonicalJson({ manifest:e.manifest, signature }), 'utf8');
}
export function signResultManifest(value: unknown, keyId: string, signedAt: number, privateSeed: Uint8Array): SignedResultManifest {
  const e = envelope({ manifest:value, signature:{profile:PROFILE, algorithm:'ed25519', keyId, signedAt, value:Buffer.alloc(64).toString('base64url')} });
  bytes(privateSeed, 32, 'INVALID_SIGNING_KEY');
  const key = createPrivateKey({ key:Buffer.concat([Buffer.from('302e020100300506032b657004220420','hex'),privateSeed]), format:'der', type:'pkcs8' });
  e.signature.value = sign(null, resultSigningInput(e), key).toString('base64url');
  return e;
}
/** Verifies signature and host policy only. Use verifyResultArtifacts to check the saved files. */
export function verifyResultManifest(value: unknown, policy: ResultVerificationPolicy): ResultManifest {
  const e = envelope(value);
  requireValue(exact(policy, ['keyId','publicKey','status','bundleSha256','now']) && typeof policy.keyId === 'string' && KEY_ID.test(policy.keyId) &&
    ['active','revoked'].includes(policy.status) && digest(policy.bundleSha256) && integer(policy.now), 'INVALID_RESULT_POLICY');
  bytes(policy.publicKey, 32, 'INVALID_RESULT_POLICY');
  requireValue(policy.keyId === e.signature.keyId, 'UNKNOWN_RESULT_KEY');
  requireValue(policy.status === 'active', 'REVOKED_RESULT_KEY');
  requireValue(policy.bundleSha256 === e.manifest.bundleSha256, 'RESULT_SCOPE_MISMATCH');
  const key = createPublicKey({key:Buffer.concat([Buffer.from('302a300506032b6570032100','hex'),policy.publicKey]),format:'der',type:'spki'});
  requireValue(verify(null, resultSigningInput(e), key, Buffer.from(e.signature.value,'base64url')), 'INVALID_RESULT_SIGNATURE');
  requireValue(e.signature.signedAt <= policy.now, 'RESULT_NOT_YET_VALID');
  return e.manifest;
}

/** Bounded caller-supplied file reader; never fetches paths, keys or URLs from a document. */
export function verifyResultArtifacts(value: unknown, readArtifact: (path: string) => Uint8Array): void {
  const m = validateResultManifest(value), documents: Record<string, any> = Object.create(null);
  for (const f of m.artifacts) {
    let data: Uint8Array;
    try { data = readArtifact(f.path); } catch { throw new ResultManifestError('MISSING_RESULT_ARTIFACT'); }
    requireValue(data instanceof Uint8Array && data.length === f.bytes && hash(data) === f.sha256, 'RESULT_ARTIFACT_MISMATCH');
    if (REQUIRED.includes(f.path)) {
      try { documents[f.path] = parseJson(new TextDecoder('utf-8', {fatal:true,ignoreBOM:true}).decode(data)); }
      catch { throw new ResultManifestError('INVALID_RESULT_ARTIFACT'); }
    }
  }
  const source = documents['manifest.json'], bundle = documents['bundle.json'];
  requireValue(record(source) && source.schemaVersion === 1 && source.scope === 'heldout-execution-result-0.1' &&
    source.signed === false && source.fullStudy === false && source.independentReview === false &&
    ['bundleSha256','planSha256','corpusSha256','mode','status','recovered'].every(k => source[k] === (m as any)[k]), 'RESULT_BINDING_MISMATCH');
  const expected = m.artifacts.filter(f => f.path !== 'manifest.json').map(({path,sha256}) => ({path,sha256}));
  requireValue(Array.isArray(source.files) && canonicalJson(source.files) === canonicalJson(expected), 'RESULT_BINDING_MISMATCH');
  requireValue(record(bundle) && Object.hasOwn(bundle,'plan') && objectHash(bundle) === m.bundleSha256 && bundle.planSha256 === m.planSha256 &&
    bundle.corpusSha256 === m.corpusSha256 && bundle.mode === m.mode && bundle.evidencePolicy === m.evidencePolicy &&
    objectHash(bundle.plan) === m.planSha256 && objectHash(documents['corpus.json']) === m.corpusSha256, 'RESULT_BINDING_MISMATCH');
}
