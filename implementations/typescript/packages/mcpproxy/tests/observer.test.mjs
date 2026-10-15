// SPDX-License-Identifier: Apache-2.0
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import {suite,runCase} from '../../../../../scripts/observer-fixtures.mjs';
import {fixture,runCase as runGate} from '../../../../../scripts/dispatch-fixtures.mjs';
import {OBSERVE_PROFILE,makeEmitter,byteLength,textBytes,scopeOf} from '../dist/index.js';
const schema=JSON.parse(readFileSync(new URL('../../../../../schemas/observer-0.1.schema.json',import.meta.url),'utf8'));
const validate=new Ajv2020({strict:true}).compile(schema);
for(const c of suite.cases.filter(c=>c.engine==='gate'))test('observer: '+c.id,async()=>{
  const actual=await runCase(c);
  assert.deepEqual(actual.codes,c.expected.codes);
  assert.deepEqual(actual.types,c.expected.types,JSON.stringify(actual.types));
  for(const event of actual.events) {
    assert(validate(event),JSON.stringify(validate.errors)+' '+JSON.stringify(event));
    assert.equal(event.profile,OBSERVE_PROFILE);
    assert.equal(event.source,'mcpproxy');
    assert(!JSON.stringify(event).includes('PRIVATE_'));
    if(c.level!=='inspect')assert(!Object.hasOwn(event.data,'payload'));
  }
});
test('observer: option shape is validated like other configuration',async()=>{
  for(const observe of [{},{observer:'x'},{observer:()=>{},level:'verbose'},{observer:()=>{},extra:1},'x',null])
    await assert.rejects(fixture({observe}),{code:'INVALID_CONFIGURATION'});
});
test('observer: a failing observer never changes gate outcomes',async()=>{
  const plain=await runGate({settings:{}});
  const observed=await runGate({settings:{observe:{observer:()=>{throw new Error('PRIVATE_OBSERVER_DETAIL');}}}});
  assert.deepEqual(observed,plain);
});
test('observer: emitter helpers are size signals with filtered scope',()=>{
  assert.equal(byteLength({b:1,a:'x'}),15);
  assert.equal(textBytes('🧪'),4);
  assert.deepEqual(scopeOf({sessionId:'s',requestId:7,step:2,round:'x',tenantId:'t'}),{sessionId:'s',step:2});
  const seen=[];
  const emit=makeEmitter('mcpproxy',{observer:e=>seen.push(e)},code=>{throw new Error(code);});
  emit('dispatch.enter',{sessionId:'s'},{operation:'listTools',allowedCount:0,registeredCount:0},()=>({secret:true}));
  assert.deepEqual(seen,[{profile:OBSERVE_PROFILE,source:'mcpproxy',type:'dispatch.enter',scope:{sessionId:'s'},data:{operation:'listTools',allowedCount:0,registeredCount:0}}]);
  assert.throws(()=>makeEmitter('mcpproxy',{observer:1},code=>{throw new Error(code);}),{message:'INVALID_CONFIGURATION'});
  assert.doesNotThrow(()=>makeEmitter('mcpproxy',undefined,code=>{throw new Error(code);})('x',{},{}));
});
