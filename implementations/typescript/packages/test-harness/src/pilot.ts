// SPDX-License-Identifier: Apache-2.0
/** Offline planning and exploratory analysis. No credentials, I/O or execution authority. */
import { createHash } from 'node:crypto';
import { canonicalJson, parseJson, record } from '@psp-cdl/core';

const CONDITIONS = ['unprotected', 'psp-only', 'cdl-only', 'combined'] as const;
const LANGUAGES = ['typescript', 'python'] as const;
const FAMILIES = ['direct-read', 'indirect-read', 'restricted-display'] as const;
const METRICS = ['attackSuccess', 'benignSuccess', 'falseDenial'] as const;
type Condition = typeof CONDITIONS[number];
type Language = typeof LANGUAGES[number];
type Metric = typeof METRICS[number];
type Provenance = 'synthetic-fixture' | 'unreviewed-input';
export interface PilotPair { id: string; family: typeof FAMILIES[number]; attackCaseId: string; benignCaseId: string }
export interface PilotRequest {
  schemaVersion: 1; manifest: { provenance: Provenance; pairs: PilotPair[] };
  pairsPerFamily: number; repetitions: number; orderSeed: number; analysisSeed: number; bootstrapResamples: number;
}
export interface PilotTrial {
  id: string; pairId: string; caseId: string; family: PilotPair['family']; kind: 'attack' | 'benign';
  condition: Condition; host: Language; peer: Language; repeat: number; topology: 'B';
}
export interface PilotPlan {
  schemaVersion: 1; scope: 'pilot-plan-0.1'; status: 'draft'; executionAuthorized: false; fullStudy: false;
  orderAlgorithm: 'sha256-sort-0.1'; request: PilotRequest; requestSha256: string; trials: PilotTrial[]; trialsSha256: string;
}
export interface PilotOutcome {
  trialId: string; status: 'observed' | 'error' | 'cancelled' | 'skipped';
  attackSuccess: boolean | null; benignSuccess: boolean | null; falseDenial: boolean | null;
}
export interface PilotOutcomes { schemaVersion: 1; planSha256: string; provenance: Provenance; rows: PilotOutcome[] }
interface Rate { true: number; false: number; unknown: number; total: number; rateAmongKnown: number | null; lower: number; upper: number }
export class PilotError extends Error {
  constructor(public readonly code: string) { super(code); this.name = 'PilotError'; }
}
function requireValue(condition: unknown, code: string): asserts condition { if (!condition) throw new PilotError(code); }
function exact(value: unknown, keys: readonly string[]): value is Record<string, any> {
  return record(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}
const integer = (value: unknown, low: number, high: number): boolean => Number.isSafeInteger(value) && Number(value) >= low && Number(value) <= high;
function copy(value: unknown, code: string): any {
  try { return parseJson(canonicalJson(value)); } catch { throw new PilotError(code); }
}
const sha256 = (value: string): string => createHash('sha256').update(value, 'utf8').digest('hex');
/** SHA-256 of UTF-8 RFC 8785 canonical JSON, using the shared core. */
export const pilotDigest = (value: unknown): string => sha256(canonicalJson(value));

export function createPilotPlan(value: unknown): PilotPlan {
  const input = copy(value, 'INVALID_REQUEST');
  requireValue(exact(input, ['schemaVersion', 'manifest', 'pairsPerFamily', 'repetitions', 'orderSeed', 'analysisSeed', 'bootstrapResamples']) && input.schemaVersion === 1, 'INVALID_REQUEST');
  for (const [key, low, high] of [['pairsPerFamily',1,8], ['repetitions',1,20], ['orderSeed',1,2147483647], ['analysisSeed',1,2147483647], ['bootstrapResamples',200,10000]] as const) {
    requireValue(integer(input[key], low, high), 'INVALID_REQUEST');
  }
  const manifest = input.manifest;
  requireValue(exact(manifest, ['provenance','pairs']) && ['synthetic-fixture','unreviewed-input'].includes(manifest.provenance) && Array.isArray(manifest.pairs) && manifest.pairs.length === 3*input.pairsPerFamily, 'INVALID_MANIFEST');
  const pairIds = new Set<string>(), caseIds = new Set<string>();
  for (const pair of manifest.pairs) {
    requireValue(exact(pair, ['id','family','attackCaseId','benignCaseId']) && FAMILIES.includes(pair.family), 'INVALID_MANIFEST');
    for (const key of ['id','attackCaseId','benignCaseId']) requireValue(typeof pair[key] === 'string' && /^[a-z0-9][a-z0-9_-]{0,63}(?![\s\S])/.test(pair[key]), 'INVALID_MANIFEST');
    requireValue(!pairIds.has(pair.id) && !caseIds.has(pair.attackCaseId) && !caseIds.has(pair.benignCaseId) && pair.attackCaseId !== pair.benignCaseId, 'INVALID_MANIFEST');
    pairIds.add(pair.id); caseIds.add(pair.attackCaseId); caseIds.add(pair.benignCaseId);
  }
  for (const family of FAMILIES) requireValue(manifest.pairs.filter((p: PilotPair) => p.family === family).length === input.pairsPerFamily, 'INVALID_MANIFEST');
  requireValue(pairIds.size * 2 * input.repetitions * 16 <= 4096, 'LIMIT_EXCEEDED');
  manifest.pairs.sort((a: PilotPair,b: PilotPair) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const request = input as PilotRequest, trials: PilotTrial[] = [];
  for (const pair of request.manifest.pairs) for (const kind of ['attack','benign'] as const)
    for (const condition of CONDITIONS) for (const host of LANGUAGES) for (const peer of LANGUAGES)
      for (let repeat = 1; repeat <= request.repetitions; repeat++) {
        const caseId = kind === 'attack' ? pair.attackCaseId : pair.benignCaseId;
        trials.push({ id:`${caseId}/${condition}/${host}/${peer}/${repeat}`, pairId:pair.id, caseId, family:pair.family, kind, condition, host, peer, repeat, topology:'B' });
      }
  const keys = new Map(trials.map(t => [t.id, sha256(`PSP-PILOT-ORDER-0.1\n${request.orderSeed}\n${t.id}`)]));
  trials.sort((a,b) => keys.get(a.id)! < keys.get(b.id)! ? -1 : keys.get(a.id)! > keys.get(b.id)! ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  return { schemaVersion:1, scope:'pilot-plan-0.1', status:'draft', executionAuthorized:false, fullStudy:false,
    orderAlgorithm:'sha256-sort-0.1', request, requestSha256:pilotDigest(request), trials, trialsSha256:pilotDigest(trials) };
}

function validatePlan(value: unknown): PilotPlan {
  const plan = copy(value, 'INVALID_PLAN');
  requireValue(record(plan) && 'request' in plan, 'INVALID_PLAN');
  let expected: PilotPlan;
  try { expected = createPilotPlan(plan.request); } catch { throw new PilotError('INVALID_PLAN'); }
  requireValue(canonicalJson(plan) === canonicalJson(expected), 'INVALID_PLAN');
  return expected;
}

function validateOutcomes(plan: PilotPlan, value: unknown): PilotOutcomes {
  const outcomes = copy(value, 'INVALID_OUTCOMES');
  requireValue(exact(outcomes, ['schemaVersion','planSha256','provenance','rows']) && outcomes.schemaVersion === 1 && outcomes.planSha256 === pilotDigest(plan) && outcomes.provenance === plan.request.manifest.provenance && Array.isArray(outcomes.rows) && outcomes.rows.length === plan.trials.length, 'INVALID_OUTCOMES');
  for (const [i, trial] of plan.trials.entries()) {
    const row = outcomes.rows[i];
    requireValue(exact(row, ['trialId','status',...METRICS]) && row.trialId === trial.id && ['observed','error','cancelled','skipped'].includes(row.status) && METRICS.every(k => row[k] === null || typeof row[k] === 'boolean'), 'INVALID_OUTCOMES');
    if (trial.kind === 'attack') {
      requireValue(row.benignSuccess === null && row.falseDenial === null, 'INVALID_OUTCOMES');
      if (row.status === 'observed') requireValue(typeof row.attackSuccess === 'boolean', 'INVALID_OUTCOMES');
      else if (row.status === 'skipped') requireValue(row.attackSuccess === null, 'INVALID_OUTCOMES');
      else requireValue(row.attackSuccess === null || row.attackSuccess === true, 'INVALID_OUTCOMES');
    } else {
      requireValue(row.attackSuccess === null, 'INVALID_OUTCOMES');
      if (row.status === 'observed') requireValue(typeof row.benignSuccess === 'boolean' && typeof row.falseDenial === 'boolean' && !(row.benignSuccess && row.falseDenial), 'INVALID_OUTCOMES');
      else requireValue(row.benignSuccess === null && row.falseDenial === null, 'INVALID_OUTCOMES');
    }
  }
  return outcomes as PilotOutcomes;
}

function draws(seed: number, count: number, resamples: number): number[][] {
  const threshold = 2**32 - 2**32 % count, samples: number[][] = [];
  let counter = 0;
  for (let n = 0; n < resamples; n++) {
    const sample: number[] = [];
    while (sample.length < count) {
      const word = createHash('sha256').update(`PSP-PILOT-BOOTSTRAP-0.1\n${seed}\n${counter++}`, 'ascii').digest().readUInt32BE(0);
      if (word < threshold) sample.push(word % count);
    }
    samples.push(sample);
  }
  return samples;
}

function rate(values: (boolean | null)[]): Rate {
  const yes = values.filter(v => v === true).length, no = values.filter(v => v === false).length, total = values.length, unknown = total - yes - no;
  return { true:yes, false:no, unknown, total, rateAmongKnown:yes+no ? yes/(yes+no) : null, lower:yes/total, upper:(yes+unknown)/total };
}
function interval(values: number[]) {
  values.sort((a,b) => a-b);
  return { low:values[Math.ceil(values.length/40)-1]!, high:values[Math.ceil(39*values.length/40)-1]!, degenerate:values[0] === values.at(-1) };
}
const sum = (values: number[]): number => values.reduce((a,b) => a+b, 0);

export function analyzePilot(planValue: unknown, outcomesValue: unknown) {
  const plan = validatePlan(planValue), outcomes = validateOutcomes(plan, outcomesValue), request = plan.request;
  const pairs = request.manifest.pairs, pairIds = pairs.map(p => p.id);
  const samples = draws(request.analysisSeed, pairs.length, request.bootstrapResamples), drawHash = createHash('sha256');
  for (const sample of samples) drawHash.update(canonicalJson(sample)+'\n', 'ascii');
  const joined = plan.trials.map((t,i) => ({t,r:outcomes.rows[i]!}));
  const groups = [];
  for (const host of LANGUAGES) for (const peer of LANGUAGES) {
    const rows = joined.filter(({t}) => t.host === host && t.peer === peer);
    const rates = (items: typeof joined) => CONDITIONS.map(condition => ({ condition, metrics:Object.fromEntries(METRICS.map(metric => [metric,
      rate(items.filter(({t}) => t.condition === condition && t.kind === (metric === 'attackSuccess' ? 'attack' : 'benign')).map(({r}) => r[metric]))])) as Record<Metric,Rate> }));
    const conditionRates = rates(rows), counts = new Map(conditionRates.map(c => [c.condition,c.metrics]));
    const contrasts = [];
    for (const metric of METRICS) for (const control of CONDITIONS.slice(0,-1)) {
      const kind = metric === 'attackSuccess' ? 'attack' : 'benign';
      const byPair = new Map(pairIds.map(id => [id, new Map<Condition,(boolean|null)[]>([['combined',[]],[control,[]]])]));
      for (const {t,r} of rows) if (t.kind === kind && (t.condition === 'combined' || t.condition === control)) byPair.get(t.pairId)!.get(t.condition)!.push(r[metric]);
      const lowerCounts: number[] = [], upperCounts: number[] = [];
      for (const id of pairIds) {
        const a = rate(byPair.get(id)!.get('combined')!), b = rate(byPair.get(id)!.get(control)!);
        lowerCounts.push(a.true - b.true - b.unknown); upperCounts.push(a.true + a.unknown - b.true);
      }
      const denominator = pairs.length*request.repetitions, a = counts.get('combined')![metric], b = counts.get(control)![metric];
      contrasts.push({ metric, treatment:'combined', control, clusters:pairs.length,
        knownDifference:a.rateAmongKnown !== null && b.rateAmongKnown !== null ? a.rateAmongKnown-b.rateAmongKnown : null,
        lower:sum(lowerCounts)/denominator, upper:sum(upperCounts)/denominator,
        lowerBoundPercentile95:interval(samples.map(sample => sum(sample.map(i => lowerCounts[i]!))/denominator)),
        upperBoundPercentile95:interval(samples.map(sample => sum(sample.map(i => upperCounts[i]!))/denominator)) });
    }
    groups.push({host, peer, planned:rows.length, clusters:pairs.length,
      statuses:Object.fromEntries(['observed','error','cancelled','skipped'].map(s => [s,rows.filter(({r}) => r.status === s).length])),
      conditions:conditionRates, families:FAMILIES.map(family => ({family,conditions:rates(rows.filter(({t}) => t.family === family))})), contrasts });
  }
  return { schemaVersion:1, scope:'pilot-analysis-0.1', provenance:outcomes.provenance, fullStudy:false, independentReview:false,
    planSha256:pilotDigest(plan), outcomesSha256:pilotDigest(outcomes), method:'paired-case-cluster-percentile-0.1',
    analysisSeed:request.analysisSeed, bootstrapResamples:request.bootstrapResamples, resampleIndicesSha256:drawHash.digest('hex'), groups,
    limitations:['Exploratory percentile intervals for each bound estimator; no simultaneous or multiplicity-adjusted coverage claim.',
      'Whole case pairs are resampled; repeated calls and language pairs are not independent clusters.',
      'Unreviewed input labels and hashes do not establish corpus provenance, grading independence or effectiveness.',
      'Degenerate intervals and zero observed attacks do not establish zero risk. No family-level intervals.'] };
}
