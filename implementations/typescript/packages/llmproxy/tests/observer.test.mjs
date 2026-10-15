// SPDX-License-Identifier: Apache-2.0
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import {suite,runCase} from '../../../../../scripts/observer-fixtures.mjs';
import {fixture,runCase as runLoop} from '../../../../../scripts/llm-fixtures.mjs';
import {OBSERVE_PROFILE} from '../dist/index.js';
const schema=JSON.parse(readFileSync(new URL('../../../../../schemas/observer-0.1.schema.json',import.meta.url),'utf8'));
const validate=new Ajv2020({strict:true}).compile(schema);
const PRIVATE=['test-owner','tenant-a','subject-a','test-signing-key','PRIVATE_'];
for(const c of suite.cases.filter(c=>c.engine!=='gate'))test('observer: '+c.id,async()=>{
  const actual=await runCase(c);
  assert.deepEqual(actual.codes,c.expected.codes,JSON.stringify(actual.codes));
  assert.deepEqual(actual.types,c.expected.types,JSON.stringify(actual.types));
  for(const event of actual.events) {
    // The wrapper redacts session-bound prompt digests; restore a well-formed placeholder for schema validation.
    const shaped=JSON.parse(JSON.stringify(event).replaceAll('<prompt-digest>','0'.repeat(64)));
    assert(validate(shaped),JSON.stringify(validate.errors)+' '+JSON.stringify(event));
    assert.equal(event.profile,OBSERVE_PROFILE);
    const text=JSON.stringify(event);
    for(const value of PRIVATE)assert(!text.includes(value),value+' leaked in '+event.type);
    if(c.level!=='inspect')assert(!Object.hasOwn(event.data,'payload'),event.type);
  }
  if(c.level==='inspect')assert(actual.events.some(e=>Object.hasOwn(e.data,'payload')));
  const decisions=actual.events.filter(e=>e.type==='cdl.decision');
  for(const d of decisions)assert(Array.isArray(d.data.reasonCodes)&&(d.data.decision==='allow')===(d.data.reasonCodes.length===0));
});
test('observer: option shape is validated like other configuration',async()=>{
  for(const observe of [{},{observer:'x'},{observer:()=>{},level:'verbose'},{observer:()=>{},extra:1},'x',null,[]])
    await assert.rejects(fixture({observe}),{code:'INVALID_CONFIGURATION'});
});
test('observer: failures, promises and slow observers never change outcomes or call counts',async()=>{
  const plain=await runLoop({settings:{}});
  for(const observer of [()=>{throw new Error('PRIVATE_OBSERVER_DETAIL');},()=>Promise.reject(new Error('PRIVATE_OBSERVER_DETAIL')),e=>{e.data.code='forged';e.scope.sessionId='forged';}]) {
    const observed=await runLoop({settings:{observe:{observer}}});
    assert.deepEqual(observed,plain);
  }
});
test('observer: events are detached copies',async()=>{
  const events=[];
  const observed=await runLoop({settings:{observe:{observer:e=>{events.push(e);e.data.messageCount=-1;},level:'inspect'}}});
  assert.equal(observed.code,'OK');
  const assembled=events.filter(e=>e.type==='prompt.assembled');
  assert(assembled.length>=1);
  for(const e of assembled){assert.equal(e.data.messageCount,-1);assert.equal(e.data.payload.messages[0].role,'system');}
  assert.equal(observed.requests[0].messages[0].role,'system');
});
