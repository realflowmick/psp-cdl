// SPDX-License-Identifier: Apache-2.0
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import {suite,fixture,runCase} from '../../../../../scripts/llm-fixtures.mjs';
const schema=JSON.parse(readFileSync(new URL('../../../../../schemas/llm-loop.schema.json',import.meta.url),'utf8'));
const ajv=new Ajv2020({strict:true});ajv.addSchema(schema);
const providerRequest=ajv.getSchema(schema.$id+'#/$defs/providerRequest'),resultSchema=ajv.getSchema(schema.$id+'#/$defs/result');
for(const c of suite.cases)test(c.id,async()=>{
  const actual=await runCase(c);
  for(const [key,value] of Object.entries(c.expected))assert.deepEqual(actual[key],value,JSON.stringify(actual));
  for(const request of actual.requests) {
    assert(providerRequest(request),JSON.stringify(providerRequest.errors));
    assert.equal(request.messages[0].content,'Use the synthetic read tool when needed.');
    assert.equal(request.messages[1].role,'user');
    for(const privateValue of ['test-owner','tenant-a','subject-a','test-signing-key','sessionVersion','PRIVATE_'])assert(!JSON.stringify(request).includes(privateValue));
  }
  if(actual.released)assert(resultSchema(actual.result),JSON.stringify(resultSchema.errors));
  else assert(!Object.hasOwn(actual,'result'));
});
test('pending provider reserves owner, blocks a second loop and suppresses late cancellation output',async()=>{
  let enter,finish;
  const entered=new Promise(r=>{enter=r;}),pending=new Promise(r=>{finish=r;});
  const f=await fixture({responses:[{type:'final',text:'must not release'}],onProvider:async()=>{enter();await pending;}});
  try {
    const running=f.loop.run('test-owner',f.session.sessionId,{message:'hello'},f.options);
    const observed=assert.rejects(running,{code:'CANCELLED'});
    await entered;
    await assert.rejects(()=>f.loop.run('test-owner',f.session.sessionId,{message:'competing'},f.options),{code:'STATE_BUSY'});
    await assert.rejects(f.update,{code:'STATE_BUSY'});
    // Independent owner remains available while this callback is held.
    await f.store.execute({...f.actor,subjectId:'other'},{action:'createSession',requestId:'other-create',nodeId:'entry',nodeVersion:'1',policyVersion:'policy-1',expiresAt:1900,state:{}});
    f.baseFlags.cancelled=true;
    finish();
    await observed;
  }finally{finish();f.close();}
});
