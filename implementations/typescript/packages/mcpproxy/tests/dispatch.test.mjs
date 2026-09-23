// SPDX-License-Identifier: Apache-2.0
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {suite,runCase,fixture} from '../../../../../scripts/dispatch-fixtures.mjs';
import {checkSchema,matches} from '../dist/schema.js';
import {bindingDigest} from '../dist/index.js';
import {readFileSync} from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
const contract=JSON.parse(readFileSync(new URL('../../../../../schemas/mcp-dispatch.schema.json',import.meta.url),'utf8'));
const validateResult=new Ajv2020().addSchema(contract).compile({$ref:contract.$id+'#/$defs/result'});
for(const c of suite.cases) test(c.id,async()=>{
  const result=await runCase(c);
  for(const [k,v] of Object.entries(c.expected)) assert.deepEqual(result[k],v,c.id+': '+JSON.stringify(result));
  if(result.code==='OK'&&!c.list) {
    assert(validateResult(result.result),JSON.stringify(validateResult.errors));
    assert.deepEqual(result.result.data,c.expectedData??{message:'hello 🧪'});
    assert.equal(result.result.provenance.trustLevel,5);
    assert.equal(result.result.provenance.outputDigest,bindingDigest(result.result.data));
    assert.equal(result.result.provenance.inputDigest,bindingDigest(c.request?.arguments??{message:'hello 🧪'}));
  }
  if(c.expectedNames) assert.deepEqual(result.result.map(t=>t.name),c.expectedNames);
  assert(!JSON.stringify(result).includes('PRIVATE_'));
});
test('shared finite schema cases',()=>{
  for(const c of suite.schemaCases) {
    if(c.unsupported) assert.throws(()=>checkSchema(c.schema));
    else {checkSchema(c.schema);assert.equal(matches(c.schema,c.value),c.valid);}
  }
});
test('concurrent calls and writes fail busy; lease releases after an error',async()=>{
  const f=await fixture({throwTool:true});
  let release,entered;
  const ready=new Promise(r=>entered=r),hold=new Promise(r=>release=r);
  try {
    const work=f.coordinator.run(f.actor,async()=>{entered();await hold;});
    await ready;
    await assert.rejects(()=>f.update(),{code:'STATE_BUSY'});
    await assert.rejects(()=>f.gate.callTool('test-owner',f.session.sessionId,{name:'echo.read',arguments:{message:'test'}},f.options),{code:'STATE_BUSY'});
    release();await work;
    await assert.rejects(()=>f.gate.callTool('test-owner',f.session.sessionId,{name:'echo.read',arguments:{message:'test'}},f.options),{code:'TOOL_FAILED'});
    assert.equal((await f.update()).version,2);
  }finally{release?.();f.close();}
});
test('session cannot change while the real endpoint is awaiting its response',async()=>{
  let release,entered;
  const ready=new Promise(r=>entered=r),hold=new Promise(r=>release=r);
  const f=await fixture({onInvoke:async()=>{entered();await hold;}});
  try {
    const pending=f.gate.callTool('test-owner',f.session.sessionId,{name:'echo.read',arguments:{message:'test'}},f.options);
    await ready;
    await assert.rejects(()=>f.update(),{code:'STATE_BUSY'});
    f.flags.cancelled=true;
    release();
    await assert.rejects(()=>pending,{code:'CANCELLED'});
    assert.equal((await f.update()).version,2);
    assert.equal(f.stats().calls,1);
  }finally{release?.();f.close();}
});
test('cancellation queued when freshness resolves is checked before dispatch',async()=>{
  const f=await fixture();
  let checks=0,cancelled=false;
  f.options.cancelled=()=>{
    // The third check ends asynchronous freshness validation. Its continuation
    // may run after a cancellation microtask, so dispatch needs a synchronous check.
    if(++checks===3) queueMicrotask(()=>{cancelled=true;});
    return cancelled;
  };
  try {
    await assert.rejects(()=>f.gate.callTool('test-owner',f.session.sessionId,{name:'echo.read',arguments:{message:'test'}},f.options),{code:'CANCELLED'});
    assert.equal(f.stats().calls,0);
    assert.equal((await f.update()).version,2);
  }finally{f.close();}
});
