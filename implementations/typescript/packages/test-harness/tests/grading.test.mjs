// SPDX-License-Identifier: Apache-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createPilotPlan,validateHeldoutCorpus,gradePilotEvidence,gradePilotRecords,analyzePilot} from '@psp-cdl/test-harness';
import {validateHeldout} from '../../../../../scripts/validate-heldout.mjs';
const load=name=>JSON.parse(readFileSync(new URL('../../../../../conformance/vectors/evaluation/heldout-'+name+'-0.1.json',import.meta.url),'utf8'));
const corpus=load('corpus'),request=load('request'),suite=load('grading'),plan=createPilotPlan(request);
for(const c of suite.cases)test('observable grading: '+c.id,()=>{
  const item=corpus.cases.find(v=>v.id===c.caseId);
  if(c.expected.code)assert.throws(()=>gradePilotEvidence(item,c.record),{code:c.expected.code});
  else {
    validateHeldout('evidence',c.record);const actual=gradePilotEvidence(item,c.record);validateHeldout('grade',actual);
    assert.deepEqual(Object.fromEntries(Object.keys(c.expected).map(k=>[k,actual.row[k]])),c.expected);
    assert.equal(actual.details.independentReview,false);assert(!JSON.stringify(actual).includes(item.input.privateText));
  }
});
test('external corpus is exact, balanced and rejects injected authority',()=>{
  validateHeldout('corpus',corpus);validateHeldout('rehearsal',load('rehearsal'));
  const normalized=validateHeldoutCorpus(plan,corpus),reverse=structuredClone(corpus);reverse.cases.reverse();assert.deepEqual(validateHeldoutCorpus(plan,reverse),normalized);
  for(const mutation of ['missing','duplicate','pair','records','rubric','authority','public-relabel']){
    const value=structuredClone(corpus);
    if(mutation==='missing')value.cases.pop();if(mutation==='duplicate')value.cases[value.cases.length-1]=value.cases[0];
    if(mutation==='pair')value.cases[0].pairId='other';if(mutation==='records')value.cases[0].input.privateText+='-changed';
    if(mutation==='rubric')value.cases[0].rubric.forbiddenReads=['public'];if(mutation==='authority')value.cases[0].input.approved=true;
    if(mutation==='public-relabel')value.provenance='held-out';assert.throws(()=>validateHeldoutCorpus(plan,value),{code:'INVALID_CORPUS'});
  }
});
test('all planned evidence rows are required and compatible with paired analysis',()=>{
  const rows=plan.trials.map(t=>({trialId:t.id,completion:'skipped',observation:null,observedReads:[]}));
  const graded=gradePilotRecords(plan,corpus,rows),analysis=analyzePilot(plan,graded.outcomes);
  assert.equal(analysis.groups.reduce((s,g)=>s+g.statuses.skipped,0),96);
  for(const bad of [rows.slice(1),[...rows].reverse(),Array(96).fill(rows[0])])assert.throws(()=>gradePilotRecords(plan,corpus,bad),{code:'INVALID_EVIDENCE'});
});
