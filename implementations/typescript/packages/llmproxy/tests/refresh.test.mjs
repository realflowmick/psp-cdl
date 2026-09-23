// SPDX-License-Identifier: Apache-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import Ajv2020 from 'ajv/dist/2020.js';
import {WorkflowStore,validPromptState,comparePromptVersions} from '@psp-cdl/api-server/persistence';
import {suite,fixture,runCase} from '../../../../../scripts/refresh-fixtures.mjs';

const schema=JSON.parse(readFileSync(new URL('../../../../../schemas/persistence/prompt-refresh-0.1.schema.json',import.meta.url),'utf8'));
const ajv=new Ajv2020({strict:true});ajv.addSchema(schema);
const commandSchema=ajv.getSchema(schema.$id),stateSchema=ajv.getSchema(schema.$id+'#/$defs/promptState');
const uuid='00000000-0000-4000-8000-000000000001';
const get=f=>({action:'getPromptState',sessionId:f.session.sessionId});
for(const c of suite.cases)test('refresh: '+c.id,async()=>{
  const actual=await runCase(c);
  for(const [key,value] of Object.entries(c.expected))assert.deepEqual(actual[key],value,JSON.stringify(actual));
  for(const command of actual.commands??[])assert(commandSchema({...command,sessionId:uuid}),JSON.stringify(commandSchema.errors));
  if(actual.prompt)assert(stateSchema(actual.prompt.state),JSON.stringify(stateSchema.errors));
  for(const step of actual.steps??[])if(step.code!=='OK')assert(!Object.hasOwn(step,'value'));
  // Neither provider input nor audit events can contain authoritative bindings or private callback errors.
  for(const request of actual.requests??[]) {
    const text=JSON.stringify(request);
    for(const secret of ['test-owner','test-signing-key','PRIVATE_','authorityRevision','sessionVersion'])assert(!text.includes(secret));
    assert.equal(request.messages.filter(m=>m.role==='system').length,1);
  }
  for(const event of actual.events??[]) {
    const text=JSON.stringify(event);
    for(const secret of ['PRIVATE_','System one.','System refreshed.','Read synthetic data.'])assert(!text.includes(secret));
    if(event.digest)assert.match(event.digest,/^[a-f0-9]{64}$/);
  }
  if(['refresh-between-inferences','grace-during-tool'].includes(c.id)) {
    assert.equal(actual.requests[0].messages[0].content,'System one.');
    assert.equal(actual.requests[1].messages[0].content,'System refreshed.');
    assert.deepEqual(actual.requests[1].messages.slice(1,2),actual.requests[0].messages.slice(1));
    assert.equal(actual.requests[1].messages.at(-1).role,'tool');
  }
});
test('refresh: exact SemVer precedence and invalid versions',()=>{
  for(const [a,b,result] of suite.versions)assert.equal(comparePromptVersions(a,b),result);
  for(const v of ['1.0','01.0.0','1.0.0-01','1.0.0\n'])assert.throws(()=>comparePromptVersions(v,'1.0.0'));
});
test('refresh: receipt failure atomically rolls back the turn counter, state and answer',async()=>{
  const f=await fixture(),raw=new DatabaseSync(join(f.directory,'state.sqlite'));
  try {
    raw.exec("CREATE TRIGGER fail_turn BEFORE INSERT ON psp_records WHEN NEW.kind='receipt' AND json_extract(NEW.body,'$.profile')='PSP-LLM-DURABLE-0.1' BEGIN SELECT RAISE(ABORT,'synthetic'); END;");
    await assert.rejects(()=>f.loop.run('test-owner',f.session.sessionId,{message:'hello'},f.options),{code:'HOST_ERROR'});
    const before=await f.store.execute(f.actor,get(f));
    assert.equal(before.state.turnCount,0);assert.equal(before.sessionVersion,1);
    assert.equal((await f.store.execute(f.actor,{action:'getSession',sessionId:f.session.sessionId})).version,1);
    await assert.rejects(()=>f.store.execute(f.actor,{action:'getTurn',sessionId:f.session.sessionId,requestId:'turn-1'}),{code:'NOT_FOUND'});
    raw.exec('DROP TRIGGER fail_turn');
    await f.loop.run('test-owner',f.session.sessionId,{message:'hello'},f.options);
    const after=await f.store.execute(f.actor,get(f));
    assert.equal(after.state.turnCount,1);assert.equal(after.sessionVersion,2);assert.equal(after.revision,before.revision+1);
    await f.store.execute(f.actor,f.commands.at(-1));
    assert.deepEqual(await f.store.execute(f.actor,get(f)),after);
  }finally{raw.close();f.close();}
});
test('refresh: store opt-in, owner isolation, invalid metadata and legacy transitions',async()=>{
  const f=await fixture();
  try {
    await f.loop.run('test-owner',f.session.sessionId,{message:'hello'},f.options);
    const current=await f.store.execute(f.actor,get(f));
    const command={action:'putPromptState',sessionId:f.session.sessionId,expectedVersion:2,refreshRevision:current.revision,state:{...current.state,turnCount:0,refreshCount:1,timestamp:1001}};
    const legacy=new WorkflowStore(f.backend,{resumeSecret:new Uint8Array(32).fill(7),authorizePersistence:()=>true,durableTurns:true});
    for(const c of [get(f),command,f.commands[0]])await assert.rejects(()=>legacy.execute(f.actor,c),{code:'INVALID_COMMAND'});
    for(const actor of [{...f.actor,subjectId:'other'},{...f.actor,tenantId:'other'}])await assert.rejects(()=>f.store.execute(actor,get(f)),{code:'NOT_FOUND'});
    for(const changed of [{version:'v1.0.0'},{digest:'a'.repeat(64)+'\n'},{interval:true},{grace:-1},{turnCount:9007199254740992},{policies:['expiration','expiration']},{policies:['interval'],interval:0},{unexpected:true}]) {
      const state={...command.state,...changed};
      assert.equal(stateSchema(state),false);assert.equal(validPromptState(state),false);
      await assert.rejects(()=>f.store.execute(f.actor,{...command,state}),{code:changed.turnCount===9007199254740992?'INVALID_STATE':'INVALID_COMMAND'});
    }
    await assert.rejects(()=>f.store.execute(f.actor,{...command,state:{...command.state,version:'0.9.0'}}),{code:'PROMPT_ROLLBACK'});
    await assert.rejects(()=>f.store.execute(f.actor,{...command,state:{...command.state,expires:command.state.timestamp}}),{code:'INVALID_COMMAND'});
    await f.store.execute(f.actor,{action:'updateSession',requestId:'legacy',sessionId:f.session.sessionId,expectedVersion:2,nodeId:'entry',nodeVersion:'1',policyVersion:'policy-1',status:'running',state:{}});
    await assert.rejects(()=>f.loop.run('test-owner',f.session.sessionId,{message:'hello'},{...f.options,requestId:'turn-3',expectedVersion:3}),{code:'STALE_PROMPT'});
    await assert.rejects(()=>f.store.execute(f.actor,{...command,expectedVersion:3}),{code:'STATE_CONFLICT'});
  }finally{f.close();}
});
test('refresh: reservations are owner-bound, unforgeable, scoped and expire',async()=>{
  const f=await fixture();let borrowed;
  try {
    await f.loop.run('test-owner',f.session.sessionId,{message:'hello'},f.options);
    const current=await f.store.execute(f.actor,get(f));
    const command={action:'putPromptState',sessionId:f.session.sessionId,expectedVersion:2,refreshRevision:current.revision,state:{...current.state,turnCount:0,refreshCount:1,timestamp:1001}};
    await f.coordinator.runReserved(f.actor,async reservation=>{
      borrowed=reservation;
      await assert.rejects(()=>f.store.execute(f.actor,command),{code:'STATE_BUSY'});
      await assert.rejects(()=>f.store.execute(f.actor,command,undefined,{}),{code:'INVALID_RESERVATION'});
      await assert.rejects(()=>f.store.execute({...f.actor,subjectId:'other'},command,undefined,reservation),{code:'INVALID_RESERVATION'});
      await assert.rejects(()=>f.store.execute(f.actor,f.commands[0],undefined,reservation),{code:'INVALID_RESERVATION'});
      await f.store.execute(f.actor,command,()=>true,reservation);
    });
    await assert.rejects(()=>f.store.execute(f.actor,command,undefined,borrowed),{code:'INVALID_RESERVATION'});
    assert.equal((await f.store.execute(f.actor,get(f))).state.refreshCount,1);
  }finally{f.close();}
});
test('refresh: pending host refresh reserves owner and rechecks cancellation',async()=>{
  const f=await fixture({base:{now:1100}});let enter,finish;
  const entered=new Promise(r=>enter=r),pending=new Promise(r=>finish=r);
  f.flags.onRefresh=async()=>{enter();await pending;};
  try {
    const running=f.loop.run('test-owner',f.session.sessionId,{message:'hello'},f.options);
    const rejected=assert.rejects(running,{code:'CANCELLED'});
    await entered;
    await assert.rejects(f.update,{code:'STATE_BUSY'});
    await f.store.execute({...f.actor,subjectId:'other'},{action:'createSession',requestId:'other',nodeId:'entry',nodeVersion:'1',policyVersion:'policy-1',expiresAt:1900,state:{}});
    f.baseFlags.cancelled=true;finish();await rejected;
    assert.equal((await f.store.execute(f.actor,get(f))).state.version,'1.0.0');
    assert.equal(f.stats().providerCalls,0);
  }finally{finish();f.close();}
});
