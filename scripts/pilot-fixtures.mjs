// SPDX-License-Identifier: Apache-2.0
import {readFileSync} from 'node:fs';
import {createPilotPlan,analyzePilot,pilotDigest} from '@psp-cdl/test-harness';
export const suite=JSON.parse(readFileSync(new URL('../conformance/vectors/evaluation/pilot-0.1.json',import.meta.url),'utf8'));
export function fixtureOutcomes(plan,scenario='known-improvement') {
  const rows=plan.trials.map(trial=>{
    const attack=trial.kind==='attack';let success=trial.condition!=='combined';
    if(scenario==='matched-clusters')success=trial.family==='direct-read';
    if(scenario==='varying-clusters')success=success&&trial.family==='direct-read';
    if(scenario==='effect-before-error')success=trial.condition==='combined';
    const row={trialId:trial.id,status:'observed',attackSuccess:attack?success:null,benignSuccess:attack?null:true,falseDenial:attack?null:false};
    if(scenario==='all-unknown')Object.assign(row,{status:'error',attackSuccess:null,benignSuccess:null,falseDenial:null});
    if(scenario==='effect-before-error'&&attack&&success)row.status='error';
    return row;
  });
  return {schemaVersion:1,planSha256:pilotDigest(plan),provenance:plan.request.manifest.provenance,rows};
}
export function runCase(c) {
  const scenario=c.id;let request=structuredClone(suite.request);
  try {
    if(scenario==='duplicate-case')request.manifest.pairs[1].attackCaseId=request.manifest.pairs[0].attackCaseId;
    if(scenario==='missing-family')request.manifest.pairs[1].family='direct-read';
    if(scenario==='newline-identifier')request.manifest.pairs[0].id+='\n';
    if(scenario==='boolean-seed')request.orderSeed=true;
    if(scenario==='unknown-request-field')request.apiKey='rejected-synthetic';
    if(scenario==='trial-bound') {
      request=JSON.parse(readFileSync(new URL('../conformance/vectors/evaluation/pilot-request-0.1.json',import.meta.url),'utf8'));request.repetitions=20;
    }
    const plan=createPilotPlan(request);let outcomes=fixtureOutcomes(plan,scenario);const rows=outcomes.rows;
    const attack=rows[plan.trials.findIndex(t=>t.kind==='attack')],benign=rows[plan.trials.findIndex(t=>t.kind==='benign')];
    if(scenario==='missing-row')rows.pop();
    if(scenario==='duplicate-row')rows[rows.length-1]=structuredClone(rows[0]);
    if(scenario==='reordered-rows')[rows[0],rows[1]]=[rows[1],rows[0]];
    if(scenario==='extra-row')rows.push(structuredClone(rows[0]));
    if(scenario==='wrong-plan-digest')outcomes.planSha256='0'.repeat(64);
    if(scenario==='wrong-provenance')outcomes.provenance='unreviewed-input';
    if(scenario==='extra-authority')rows[0].approved=true;
    if(scenario==='wrong-kind')attack.benignSuccess=true;
    if(scenario==='error-as-defense')Object.assign(attack,{status:'error',attackSuccess:false});
    if(scenario==='skipped-as-success')Object.assign(attack,{status:'skipped',attackSuccess:true});
    if(scenario==='utility-denial-conflict')Object.assign(benign,{benignSuccess:true,falseDenial:true});
    if(scenario==='changed-trial')plan.trials[0].caseId='changed';
    if(scenario==='rehashed-order'){plan.trials.reverse();plan.trialsSha256=pilotDigest(plan.trials);outcomes=fixtureOutcomes(plan,scenario);}
    if(scenario==='execution-claim')plan.executionAuthorized=true;
    return {code:'OK',planSha256:pilotDigest(plan),trialsSha256:plan.trialsSha256,trials:plan.trials.length,analysis:analyzePilot(plan,outcomes)};
  }catch(e){return {code:e.code??'UNEXPECTED_ERROR'};}
}
