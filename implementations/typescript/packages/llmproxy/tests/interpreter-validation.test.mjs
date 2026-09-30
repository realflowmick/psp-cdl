// SPDX-License-Identifier: Apache-2.0
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runCase,configuration} from '../../../../../scripts/context-service-fixtures.mjs';
import {gradeCase} from '../../../../../scripts/interpreter-validation.mjs';
import {validate} from '../../../../../scripts/validate-interpreter.mjs';
import {runCase as runProvider} from '../../../../../scripts/provider-fixtures.mjs';
const read=p=>readFileSync(new URL('../../../../../'+p,import.meta.url),'utf8').replaceAll('\r\n','\n');
const suite=JSON.parse(read('conformance/vectors/llm/interpreter-validation-0.1.json'));
const config={...configuration,application:read('examples/in-context/validation/application.psp')};

for(const c of JSON.parse(read('conformance/vectors/llm/openai-context-0.1.json')).cases)test('context provider mapping: '+c.id,async()=>{
  const actual=await runProvider(c);
  for(const [k,v] of Object.entries(c.expected))assert.deepEqual(actual[k],v,JSON.stringify(actual));
  if(c.id==='context-text-preserved')assert.deepEqual(actual.requests[0].messages,c.settings.request.messages);
  if(c.id==='context-around-tool-pair') {
    assert.equal(actual.requests[0].messages[5].tool_calls[0].id,actual.requests[0].messages[6].tool_call_id);
    assert.deepEqual(actual.requests[0].messages.slice(0,5),c.settings.request.messages.slice(0,5));
  }
});

for(const c of suite.cases)test('joint interpreter rehearsal: '+c.id,async()=>{
  const actual=await runCase(c,{capture:true,configuration:config});
  const observation={profile:suite.profile,caseId:c.id,mode:'rehearsal',language:'typescript',usage:[],actual};
  validate('observation',observation);
  const grade=gradeCase(c,observation);
  assert.equal(grade.boundaryStatus,'passed',JSON.stringify(grade));
  assert.equal(grade.behaviorStatus,'not-run');
  const wire=JSON.stringify(actual.trace.map(t=>t.request));
  for(const rubric of c.rubric)assert(!wire.includes(rubric),'Reviewer rubric leaked to provider');
  // Even a live-labeled passing observation needs semantic review.
  assert.equal(gradeCase(c,{...observation,mode:'live'}).behaviorStatus,'needs-review');
  for(const field of ['node','version','privateLeak']) {
    const bad=structuredClone(observation);
    bad.actual[field]=field==='node'?'invented':field==='version'?999:true;
    assert.equal(gradeCase(c,bad).boundaryStatus,'failed',field);
  }
  const missing=structuredClone(observation);missing.actual.trace=[];
  assert.equal(gradeCase(c,missing).boundaryStatus,'failed');
});
test('external provider sees context and effects; scripted answers cannot override it',async()=>{
  const c=suite.cases[0];let calls=0;
  const provider={id:'isolated-provider',revision:'1',complete:true,sources:[{id:'synthetic',capabilities:[]}],
    invoke:async()=>{calls++;return {type:'final',text:JSON.stringify({type:'answer',text:'I did not persist anything.'})};}};
  const actual=await runCase(c,{provider,capture:true,configuration:config});
  assert.equal(calls,1);assert.equal(actual.version,1);assert.equal(actual.node,'entry');
  assert.equal(gradeCase(c,{mode:'live',actual}).boundaryStatus,'failed');
  assert.equal(actual.trace[0].response.text.includes('did not persist'),true);
});
