// SPDX-License-Identifier: Apache-2.0
/** Offline reproduction of derived results from authenticated saved evidence. */
import {canonicalJson, parseJson, record} from '@psp-cdl/core';
import {analyzePilot, pilotDigest, validatePilotPlan} from './pilot.js';
import {gradePilotRecords, validateHeldoutCorpus, type PilotEvidence} from './grading.js';
import {ResultManifestError, verifyResultManifest, verifyResultArtifacts, type ResultVerificationPolicy} from './results.js';

const MAX_BYTES = 67_108_864;
const NOT_AUDITED = ['worker-observation-truth', 'usage-and-latency-summaries', 'source-reexecution', 'study-readiness'] as const;
export interface ResultAudit {
  schemaVersion: 1; scope: 'result-reproduction-audit-0.1'; status: 'reproduced' | 'mismatch';
  signedEnvelopeSha256: string; bundleSha256: string; planSha256: string; corpusSha256: string;
  mode: 'offline' | 'live'; runStatus: 'finalized' | 'invalid-source-changed'; recovered: boolean;
  signatureVerified: true; artifactsVerified: true; fullStudy: false; independentReview: false; executionAuthorized: false;
  trials: number; evidenceSources: {record: number; observation: number; partial: number; skipped: number};
  checks: {artifact: string; savedSha256: string; reproducedSha256: string; matches: boolean}[];
  notAudited: string[];
}
function requireValue(ok: unknown, code = 'INVALID_AUDIT_EVIDENCE'): asserts ok {
  if (!ok) throw new ResultManifestError(code);
}
function exact(v: unknown, keys: string[]): v is Record<string, any> {
  return record(v) && Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k));
}
function json(data: Uint8Array): any {
  try { return parseJson(new TextDecoder('utf-8', {fatal:true, ignoreBOM:true}).decode(data)); }
  catch { throw new ResultManifestError('INVALID_AUDIT_EVIDENCE'); }
}
// Match executor recovery: only complete, correlated lines count. A malformed
// prefix is unavailable evidence, never evidence of absence of an effect.
function partialReads(data: Uint8Array | undefined, trialId: string): string[] {
  if (!data) return [];
  try {
    const lines = new TextDecoder('utf-8', {fatal:true, ignoreBOM:true}).decode(data).split('\n').slice(0,-1);
    if (!lines.length || lines.length > 4) return [];
    const events = lines.map(line => parseJson(line) as any);
    if (events.some((e,i) => !record(e) || e.sequence !== i+1 || e.correlation !== trialId)) return [];
    if (events[0].kind !== 'isolation-probes-blocked' || events[0].recordId !== null || events[0].code !== null) return [];
    if (events.slice(1).some(e => e.kind !== 'read' || !['public','private'].includes(e.recordId) || e.code !== null)) return [];
    return events.slice(1).map(e => e.recordId);
  } catch { return []; }
}

/** Reads each artifact once into a bounded detached snapshot, after host trust
 * verification. Uses installed grading/analysis code; never executes saved code. */
export function auditResultManifest(value: unknown, policy: ResultVerificationPolicy, readArtifact: (path: string) => Uint8Array): ResultAudit {
  const envelope = parseJson(canonicalJson(value));
  const manifest = verifyResultManifest(envelope, policy);
  requireValue(manifest.artifacts.reduce((n,f) => n+f.bytes,0) <= MAX_BYTES, 'AUDIT_LIMIT_EXCEEDED');
  const snapshot = new Map<string, Uint8Array>();
  verifyResultArtifacts(manifest, name => {
    const data = readArtifact(name);
    // Bound allocation even when an untrusted reader disregards the descriptor.
    requireValue(data instanceof Uint8Array && data.length <= 4_194_304, 'RESULT_ARTIFACT_MISMATCH');
    const saved = new Uint8Array(data); snapshot.set(name,saved); return saved;
  });
  const load = (name: string): any => json(snapshot.get(name)!);
  const bundle = load('bundle.json');
  requireValue(bundle.schemaVersion === 1 && bundle.scope === 'heldout-execution-0.1', 'UNSUPPORTED_AUDIT_BUNDLE');
  const plan = validatePilotPlan(bundle.plan), corpus = validateHeldoutCorpus(plan,load('corpus.json'));
  requireValue(pilotDigest(corpus) === manifest.corpusSha256, 'RESULT_BINDING_MISMATCH');
  for (const name of snapshot.keys()) {
    if (/^[0-9]{4}\./.test(name)) requireValue(Number(name.slice(0,4)) < plan.trials.length);
  }
  const evidenceSources = {record:0, observation:0, partial:0, skipped:0}, records: PilotEvidence[] = [];
  let unstarted = false;
  for (const [i,trial] of plan.trials.entries()) {
    const stem = String(i).padStart(4,'0'), has = (suffix: string) => snapshot.has(stem+suffix);
    let evidence: PilotEvidence;
    if (!has('.started.json')) {
      unstarted = true;
      requireValue(!['.record.json','.observation.json','.timing.json','.events.jsonl'].some(has));
      evidenceSources.skipped++;
      evidence = {trialId:trial.id,completion:'skipped',observation:null,observedReads:[]};
    } else {
      requireValue(!unstarted);
      const marker = load(stem+'.started.json');
      requireValue(exact(marker,['trialId','startedAt']) && marker.trialId === trial.id && typeof marker.startedAt === 'number' && Number.isFinite(marker.startedAt));
      if (has('.record.json')) {
        evidenceSources.record++; evidence = load(stem+'.record.json');
        requireValue(record(evidence) && evidence.completion !== 'skipped');
      } else if (has('.observation.json')) {
        const saved = load(stem+'.observation.json');
        requireValue(exact(saved,['trialId','observation']) && saved.trialId === trial.id);
        evidenceSources.observation++;
        evidence = {trialId:trial.id,completion:'returned',observation:saved.observation,observedReads:[]};
      } else {
        evidenceSources.partial++;
        evidence = {trialId:trial.id,completion:'error',observation:null,observedReads:partialReads(snapshot.get(stem+'.events.jsonl'),trial.id)};
      }
    }
    records.push(evidence);
  }
  const graded = gradePilotRecords(plan,corpus,records);
  const derived = [graded.outcomes,graded.grading,analyzePilot(plan,graded.outcomes)];
  const checks = ['outcomes.json','grading.json','analysis.json'].map((artifact,i) => {
    const savedSha256 = pilotDigest(load(artifact)), reproducedSha256 = pilotDigest(derived[i]);
    return {artifact,savedSha256,reproducedSha256,matches:savedSha256 === reproducedSha256};
  });
  return {schemaVersion:1,scope:'result-reproduction-audit-0.1',status:checks.every(c => c.matches)?'reproduced':'mismatch',
    signedEnvelopeSha256:pilotDigest(envelope),bundleSha256:manifest.bundleSha256,planSha256:manifest.planSha256,corpusSha256:manifest.corpusSha256,
    mode:manifest.mode,runStatus:manifest.status,recovered:manifest.recovered,signatureVerified:true,artifactsVerified:true,
    fullStudy:false,independentReview:false,executionAuthorized:false,trials:plan.trials.length,evidenceSources,checks,notAudited:[...NOT_AUDITED]};
}
