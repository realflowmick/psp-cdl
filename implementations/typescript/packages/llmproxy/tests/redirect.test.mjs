// SPDX-License-Identifier: Apache-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {join} from 'node:path';
import {suite,fixture,runCase,sessions} from '../../../../../scripts/redirect-fixtures.mjs';
import {WorkflowStore} from '@psp-cdl/api-server/persistence';
import {bindingDigest} from '@psp-cdl/mcpproxy';
import {readFileSync} from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
const schema=JSON.parse(readFileSync(new URL('../../../../../schemas/persistence/redirect-0.1.schema.json',import.meta.url),'utf8'));
const validate=new Ajv2020({strict:false}).compile(schema);

test('shared redirect cases: actual output, target state and callback bindings',async()=>{
  for(const c of suite.cases) {
    const actual=await runCase(c);
    for(const [key,value] of Object.entries(c.expected))assert.deepEqual(actual[key],value,c.id+': '+JSON.stringify(actual));
    for(const step of actual.steps??[]) {
      if(step.code!=='OK')assert.equal(step.value,undefined);
      else assert.equal(step.value.text,'Finished 🧪');
    }
    if(actual.targets===1) {
      const target=actual.targetSessions[0];
      assert.equal(target.version,1);assert.equal(target.status,'running');
      assert.equal(target.subjectId,actual.source.subjectId);assert.equal(target.tenantId,actual.source.tenantId);
      assert.deepEqual(Object.keys(target.state).sort(),['input','retained']);
      assert.equal(target.state.input.text,'Finished 🧪');assert.deepEqual(target.state.retained,{covenants:['no-training']});
      assert.equal(JSON.stringify(target).includes('SOURCE_ONLY'),false);
      assert.equal(actual.source.llmCompletion.policy,'redirect');
    }
    assert.equal(JSON.stringify(actual.requests??[]).includes('target-policy'),false);
    assert.equal(JSON.stringify(actual.requests??[]).includes('test-owner'),false);
  }
});

test('SQL failure rolls back target, source completion and receipt together',async()=>{
  const f=await fixture(),db=new DatabaseSync(join(f.directory,'state.sqlite'));
  try {
    db.exec("CREATE TRIGGER fail_turn BEFORE INSERT ON psp_records WHEN NEW.kind='receipt' BEGIN SELECT RAISE(ABORT,'synthetic failure'); END;");
    await assert.rejects(f.loop.run('test-owner',f.session.sessionId,{message:'hello'},f.options),{code:'HOST_ERROR'});
    assert.equal(sessions(f).length,1);assert.equal(sessions(f)[0].version,1);
    await assert.rejects(f.store.execute(f.actor,{action:'getTurn',sessionId:f.session.sessionId,requestId:'turn-1'}),{code:'NOT_FOUND'});
    db.exec('DROP TRIGGER fail_turn');
    const out=await f.loop.run('test-owner',f.session.sessionId,{message:'hello'},f.options);
    assert.equal(sessions(f).length,2);assert.equal(out.redirect.sessionId,sessions(f).find(s=>s.sessionId!==f.session.sessionId).sessionId);
    assert.equal(f.policies.at(-1).binding.commandDigest,bindingDigest(f.commands.at(-1)));
  }finally{db.close();f.close();}
});

test('private command opt-in, exact schema, owner isolation and immutable target receipt',async()=>{
  const f=await fixture();
  try {
    const out=await f.loop.run('test-owner',f.session.sessionId,{message:'hello'},f.options),command=f.commands[0];
    const receipt=await f.store.execute(f.actor,command);
    assert.equal(validate(command),true,JSON.stringify(validate.errors));
    assert.deepEqual(receipt.redirect,out.redirect);assert.equal(sessions(f).length,2);
    const legacy=new WorkflowStore(f.backend,{resumeSecret:new Uint8Array(32).fill(7),authorizePersistence:()=>true,durableTurns:true});
    await assert.rejects(legacy.execute(f.actor,command),{code:'INVALID_COMMAND'});
    for(const redirect of [null,{...command.redirect,subjectId:'other'},{...command.redirect,target:'mcp://evil@host/applications/support'},{...command.redirect,nodeId:'entry'},{...command.redirect,expiresAt:true}]) {
      if(redirect?.nodeId!=='entry')assert.equal(validate({...command,redirect}),false);
      await assert.rejects(f.store.execute(f.actor,{...command,redirect}),{code:'INVALID_COMMAND'});
    }
    await assert.rejects(f.store.execute({...f.actor,subjectId:'other'},{action:'getSession',sessionId:out.redirect.sessionId}),{code:'NOT_FOUND'});
    await assert.rejects(f.store.execute(f.actor,{...command,redirect:{...command.redirect,policyVersion:'changed'}}),{code:'IDEMPOTENCY_CONFLICT'});
    await assert.rejects(f.store.execute(f.actor,{action:'updateSession',requestId:'reopen',sessionId:f.session.sessionId,expectedVersion:2,nodeId:'entry',nodeVersion:'1',policyVersion:'policy-1',status:'running',state:{}}),{code:'INVALID_TRANSITION'});
  }finally{f.close();}
});

test('target expiry at the backend transaction rolls back the entire handoff',async()=>{
  const f=await fixture(),commit=f.backend.commit.bind(f.backend);
  try {
    f.backend.commit=(...args)=>{if(args[2].some(w=>w.body.result?.redirect))f.baseFlags.now=1600;return commit(...args);};
    await assert.rejects(f.loop.run('test-owner',f.session.sessionId,{message:'hello'},f.options),{code:'EXPIRED'});
    assert.equal(sessions(f).length,1);assert.equal(sessions(f)[0].version,1);
  }finally{f.close();}
});

test('pending transfer policy reserves owner and cancellation prevents all writes',async()=>{
  const f=await fixture();let arrived,finish;
  const ready=new Promise(resolve=>{arrived=resolve;}),wait=new Promise(resolve=>{finish=resolve;}),policy=f.host.redirectPolicy;
  f.host.redirectPolicy=async(...args)=>{arrived();await wait;return policy(...args);};
  const pending=f.loop.run('test-owner',f.session.sessionId,{message:'hello'},f.options);
  try {
    await ready;
    await assert.rejects(f.update(),{code:'STATE_BUSY'});
    f.baseFlags.cancelled=true;finish();
    await assert.rejects(pending,{code:'CANCELLED'});
    assert.equal(sessions(f).length,1);assert.equal(sessions(f)[0].version,1);
  }finally{finish();await pending.catch(()=>{});f.close();}
});
