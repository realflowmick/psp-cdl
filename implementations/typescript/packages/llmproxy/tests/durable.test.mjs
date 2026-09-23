// SPDX-License-Identifier: Apache-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {join} from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import {WorkflowStore} from '@psp-cdl/api-server/persistence';
import {suite,fixture,runCase} from '../../../../../scripts/durable-fixtures.mjs';
const schema=JSON.parse(readFileSync(new URL('../../../../../schemas/persistence/turns-0.1.schema.json',import.meta.url),'utf8'));
const ajv=new Ajv2020({strict:true});ajv.addSchema(schema);
const commandSchema=ajv.getSchema(schema.$id),lockdownSchema=ajv.getSchema(schema.$id+'#/$defs/lockdown');
const uuid='00000000-0000-4000-8000-000000000001';
for(const c of suite.cases)test('durable: '+c.id,async()=>{
  const actual=await runCase(c);
  for(const [key,value] of Object.entries(c.expected))assert.deepEqual(actual[key],value,JSON.stringify(actual));
  for(const command of actual.commands??[])assert(commandSchema({...command,sessionId:uuid}),JSON.stringify(commandSchema.errors));
  for(const step of actual.steps??[]) {
    if(step.response)assert(lockdownSchema({...step.response,session_id:uuid}),JSON.stringify(lockdownSchema.errors));
    if(step.code!=='OK')assert(!Object.hasOwn(step,'value'));
    else {
      assert.equal(step.value.text,'Finished 🧪');
      assert.equal(step.value.provenance.trustLevel,5);
      assert.equal(step.value.receipt.profile,suite.profile);
    }
  }
  for(const event of actual.events??[])if(event.signal==='post_completion_override_attempt') {
    assert.deepEqual(Object.keys(event).sort(),['at','inputDigest','sessionId','signal']);
    assert.match(event.inputDigest,/^[a-f0-9]{64}$/);
  }
  if(actual.version===1)assert.deepEqual(actual.state,{stage:'initial'});
  if(actual.status==='completed')assert.deepEqual(actual.completion,{profile:suite.profile,policy:'lockdown',requestId:actual.version===3?'turn-2':'turn-1',lockedAt:1000});
});

test('durable: SQL receipt failure rolls back completion and allows a fresh authorized turn',async()=>{
  const f=await fixture(),raw=new DatabaseSync(join(f.directory,'state.sqlite'));
  try {
    raw.exec("CREATE TRIGGER fail_turn BEFORE INSERT ON psp_records WHEN NEW.kind='receipt' BEGIN SELECT RAISE(ABORT,'synthetic failure'); END;");
    await assert.rejects(()=>f.loop.run('test-owner',f.session.sessionId,{message:'hello'},f.options),{code:'HOST_ERROR'});
    assert.equal((await f.store.execute(f.actor,{action:'getSession',sessionId:f.session.sessionId})).version,1);
    await assert.rejects(()=>f.store.execute(f.actor,{action:'getTurn',sessionId:f.session.sessionId,requestId:'turn-1'}),{code:'NOT_FOUND'});
    raw.exec('DROP TRIGGER fail_turn');
    assert.equal((await f.loop.run('test-owner',f.session.sessionId,{message:'hello'},f.options)).receipt.status,'completed');
  }finally{raw.close();f.close();}
});

test('durable: low-level commands are opt-in, immutable and terminal',async()=>{
  const f=await fixture();
  try {
    await f.loop.run('test-owner',f.session.sessionId,{message:'hello'},f.options);
    const command=f.commands[0],receipt=await f.store.execute(f.actor,{action:'getTurn',sessionId:f.session.sessionId,requestId:'turn-1'});
    assert.deepEqual(await f.store.execute(f.actor,command),receipt);
    await assert.rejects(()=>f.store.execute(f.actor,{...command,state:{changed:true}}),{code:'IDEMPOTENCY_CONFLICT'});
    await assert.rejects(()=>f.store.execute(f.actor,{...command,requestId:'new',expectedVersion:2}),{code:'INVALID_TRANSITION'});
    await assert.rejects(()=>f.store.execute(f.actor,{action:'createCheckpoint',sessionId:f.session.sessionId,requestId:'cp',expectedVersion:2,expiresAt:1500}),{code:'INVALID_TRANSITION'});
    const legacy=new WorkflowStore(f.backend,{resumeSecret:new Uint8Array(32).fill(7),authorizePersistence:()=>true});
    await assert.rejects(()=>legacy.execute(f.actor,command),{code:'INVALID_COMMAND'});
    await assert.rejects(()=>legacy.execute(f.actor,{action:'getTurn',sessionId:f.session.sessionId,requestId:'turn-1'}),{code:'INVALID_COMMAND'});
    await assert.rejects(()=>legacy.execute(f.actor,{action:'updateSession',requestId:'reopen',sessionId:f.session.sessionId,expectedVersion:2,nodeId:'entry',nodeVersion:'1',policyVersion:'policy-1',status:'running',state:{}}),{code:'INVALID_TRANSITION'});
    for(const output of [{...command.output,text:'forged'},{...command.output,provenance:{...command.output.provenance,trustLevel:1}}])
      await assert.rejects(()=>f.store.execute(f.actor,{...command,output}),{code:'INVALID_COMMAND'});
    for(const inputDigest of [command.inputDigest+'\n','A'.repeat(64),'0'.repeat(63)]) {
      assert.equal(commandSchema({...command,inputDigest}),false);
      await assert.rejects(()=>f.store.execute(f.actor,{...command,inputDigest}),{code:'INVALID_COMMAND'});
    }
    f.baseFlags.now=2000;
    await assert.rejects(()=>f.store.execute(f.actor,{action:'getTurn',sessionId:f.session.sessionId,requestId:'turn-1'}),{code:'EXPIRED'});
  }finally{f.close();}
});

test('durable: pending transition reserves owner; cancellation writes neither receipt nor state',async()=>{
  const f=await fixture();let enter,finish;
  const entered=new Promise(r=>enter=r),pending=new Promise(r=>finish=r);
  f.host.authorizeTransition=async()=>{enter();await pending;return true;};
  try {
    const running=f.loop.run('test-owner',f.session.sessionId,{message:'hello'},f.options);
    const observed=assert.rejects(running,{code:'CANCELLED'});
    await entered;
    await assert.rejects(f.update,{code:'STATE_BUSY'});
    await assert.rejects(()=>f.loop.recover('test-owner',f.session.sessionId,'turn-1',f.options),{code:'STATE_BUSY'});
    await f.store.execute({...f.actor,subjectId:'other'},{action:'createSession',requestId:'other',nodeId:'entry',nodeVersion:'1',policyVersion:'policy-1',expiresAt:1900,state:{}});
    f.baseFlags.cancelled=true;finish();await observed;
    assert.equal((await f.store.execute(f.actor,{action:'getSession',sessionId:f.session.sessionId})).version,1);
    await assert.rejects(()=>f.store.execute(f.actor,{action:'getTurn',sessionId:f.session.sessionId,requestId:'turn-1'}),{code:'NOT_FOUND'});
  }finally{finish();f.close();}
});
