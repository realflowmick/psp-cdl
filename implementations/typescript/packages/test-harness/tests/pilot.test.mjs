// SPDX-License-Identifier: Apache-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import {createPilotPlan,analyzePilot} from '@psp-cdl/test-harness';
import {suite,runCase,fixtureOutcomes} from '../../../../../scripts/pilot-fixtures.mjs';
import {validatePilot} from '../../../../../scripts/validate-pilot.mjs';
for(const c of suite.cases)test('pilot: '+c.id,()=>{
  const actual=runCase(c);assert.equal(actual.code,c.code,JSON.stringify(actual));
  if(c.code==='OK'){
    validatePilot('analysis',actual.analysis);assert.equal(actual.trials,192);
    for(const group of actual.analysis.groups){const contrast=group.contrasts[0];assert.equal(contrast.lower,c.lower);assert.equal(contrast.upper,c.upper);assert.equal(contrast.lowerBoundPercentile95.degenerate,c.degenerate);}
    if(c.degenerate)for(const group of actual.analysis.groups)for(const bound of ['lower','upper']){
      assert.equal(group.contrasts[0][bound+'BoundPercentile95'].low,c[bound]);
      assert.equal(group.contrasts[0][bound+'BoundPercentile95'].high,c[bound]);
    }
  }
});
test('plan order is complete and stable under manifest permutations; seed changes only ordering',()=>{
  const request=structuredClone(suite.request),plan=createPilotPlan(request);
  validatePilot('request',request);validatePilot('plan',plan);validatePilot('outcomes',fixtureOutcomes(plan));
  assert.equal(new Set(plan.trials.map(t=>t.id)).size,192);
  request.manifest.pairs.reverse();assert.deepEqual(createPilotPlan(request),plan);
  request.orderSeed++;const changed=createPilotPlan(request);
  assert.notEqual(changed.trialsSha256,plan.trialsSha256);
  assert.deepEqual(changed.trials.map(t=>t.id).sort(),plan.trials.map(t=>t.id).sort());
  assert.equal(plan.executionAuthorized,false);
});
test('identical repetitions do not increase the cluster count or narrow intervals',()=>{
  const reports=[1,5].map(repetitions=>{const plan=createPilotPlan({...suite.request,repetitions});return analyzePilot(plan,fixtureOutcomes(plan,'varying-clusters'));});
  assert.equal(reports[0].resampleIndicesSha256,reports[1].resampleIndicesSha256);
  assert.deepEqual(reports[0].groups.map(g=>g.contrasts),reports[1].groups.map(g=>g.contrasts));
});
test('all skipped rows remain unknown with full denominators',()=>{
  const plan=createPilotPlan(suite.request),outcomes=fixtureOutcomes(plan,'all-unknown');
  outcomes.rows.forEach(r=>{r.status='skipped';});const report=analyzePilot(plan,outcomes);
  for(const group of report.groups){assert.equal(group.statuses.skipped,group.planned);for(const condition of group.conditions)for(const rate of Object.values(condition.metrics)){
    assert.equal(rate.unknown,rate.total);assert.equal(rate.lower,0);assert.equal(rate.upper,1);assert.equal(rate.rateAmongKnown,null);
  }}
  assert.equal(report.fullStudy,false);assert.equal(report.independentReview,false);
});
test('language groups retain independent summaries without pooling a changed stack',()=>{
  const plan=createPilotPlan(suite.request),outcomes=fixtureOutcomes(plan),baseline=analyzePilot(plan,outcomes);
  plan.trials.forEach((t,i)=>{if(t.host==='python'&&t.peer==='python'&&t.kind==='attack')outcomes.rows[i].attackSuccess=true;});
  const changed=analyzePilot(plan,outcomes);assert.deepEqual(changed.groups.slice(0,3),baseline.groups.slice(0,3));assert.notDeepEqual(changed.groups[3],baseline.groups[3]);
});
test('mixed missingness uses the opposite control bound',()=>{
  const plan=createPilotPlan(suite.request),outcomes=fixtureOutcomes(plan);
  plan.trials.forEach((t,i)=>{
    if(t.kind!=='attack')return;
    if(t.family==='indirect-read')Object.assign(outcomes.rows[i],{status:'cancelled',attackSuccess:null});
    else outcomes.rows[i].attackSuccess=(t.family==='direct-read')===(t.condition==='combined');
  });
  for(const group of analyzePilot(plan,outcomes).groups){
    for(const condition of group.conditions){const r=condition.metrics.attackSuccess;assert.deepEqual([r.true,r.false,r.unknown,r.total,r.rateAmongKnown],[2,2,2,6,0.5]);}
    for(const c of group.contrasts.slice(0,3))assert.deepEqual([c.lower,c.upper,c.knownDifference],[-1/3,1/3,0]);
  }
});
