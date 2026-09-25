// SPDX-License-Identifier: Apache-2.0
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import {suite,runCase} from '../../../../../scripts/provider-fixtures.mjs';
import {createOpenAIChatProvider} from '@psp-cdl/llmproxy';

const schema=JSON.parse(readFileSync(new URL('../../../../../schemas/openai-chat.schema.json',import.meta.url),'utf8'));
const validate=new Ajv2020({strict:true}).compile(schema);
assert(validate(suite.limits));
for(const c of suite.cases)test('provider: '+c.id,async()=>{
  const actual=await runCase(c);
  for(const [key,value] of Object.entries(c.expected))assert.deepEqual(actual[key],value,JSON.stringify(actual));
  for(const request of actual.requests){
    assert.equal(request.stream,false);assert.equal(request.store,false);assert.equal(request.n,1);
    assert.equal(request.model,'gpt-4.1-mini-2025-04-14');
    for(const privateValue of ['SYNTHETIC_KEY','test-owner','tenant-a','subject-a','test-signing-key','sessionVersion','PRIVATE_'])assert(!JSON.stringify(request).includes(privateValue));
  }
  assert(!JSON.stringify(actual).includes('PRIVATE_'));
  if(c.id==='single-tool')assert.deepEqual(actual.outputs,[{type:'tool',name:'echo.read',arguments:{message:'hello 🧪'}}]);
  if(c.id==='reconstructed-tool-history')assert.equal(actual.requests[0].messages[3].tool_call_id,actual.requests[0].messages[2].tool_calls[0].id);
});

test('pending provider cancels, aborts transport, and excludes competing calls',async()=>{
  let enter,aborted=false,cancelled=false;
  const entered=new Promise(r=>{enter=r;});
  const provider=createOpenAIChatProvider({mode:'offline',complete:true,sources:[],now:()=>1000,limits:suite.limits,
    transport:(_body,signal)=>new Promise((resolve,reject)=>{signal.addEventListener('abort',()=>{aborted=true;reject(new Error('PRIVATE_ABORT'));});enter();})});
  const options={deadline:1800,cancelled:()=>cancelled};
  const pending=provider.invoke(suite.request,options);
  const rejected=assert.rejects(pending,{code:'CANCELLED'});
  await entered;
  await assert.rejects(provider.invoke(suite.request,options),{code:'PROVIDER_BUSY'});
  cancelled=true;await rejected;assert(aborted);
});

test('monotonic timeout bounds a stalled provider even with a stationary host clock',async()=>{
  const provider=createOpenAIChatProvider({mode:'offline',complete:true,sources:[],now:()=>1000,limits:{...suite.limits,timeoutMs:25},transport:()=>new Promise(()=>{})});
  await assert.rejects(provider.invoke(suite.request,{deadline:1800,cancelled:()=>false}),{code:'DEADLINE_EXCEEDED'});
  await assert.rejects(provider.invoke(suite.request,{deadline:1800,cancelled:()=>false}),{code:'PROVIDER_BUSY'});
});

test('synthetic live smoke has no implicit live default',()=>{
  const result=spawnSync(process.execPath,[fileURLToPath(new URL('../../../../../scripts/smoke-openai.mjs',import.meta.url))],{encoding:'utf8'});
  assert.equal(result.status,2,result.stderr);
  assert.equal(JSON.parse(result.stdout).status,'not_run');
});
