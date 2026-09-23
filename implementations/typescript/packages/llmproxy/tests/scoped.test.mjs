// SPDX-License-Identifier: Apache-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {join} from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import {suite,fixture,runCase,records,system} from '../../../../../scripts/scoped-fixtures.mjs';
import {bindingDigest} from '@psp-cdl/mcpproxy';
import {WorkflowStore} from '@psp-cdl/api-server/persistence';
const validate=new Ajv2020({strict:false}).compile(JSON.parse(readFileSync(new URL('../../../../../schemas/persistence/scoped-0.1.schema.json',import.meta.url),'utf8')));
test('shared scoped scenarios enforce replacement, hard signals and frozen workflow',async()=>{
  for(const c of suite.cases) {
    const actual=await runCase(c);
    for(const [k,v] of Object.entries(c.expected))assert.deepEqual(actual[k],v,c.id+': '+JSON.stringify(actual));
    if(!actual.state)continue;
    assert.equal(actual.state.status,'completed');assert.deepEqual(actual.state.state,{answer:'Finished 🧪'});
    assert.equal(actual.state.llmCompletion.threatState.marker,'HOST_THREAT_ONLY');
    assert.deepEqual(actual.state.llmCompletion.scope.threatPolicy,c.settings?.explicitPolicy?{id:'restricted-threat',version:'2'}:{id:'application-threat',version:'1'});
    const scores={'scoped-answer':9,'ingress-violation':17,'egress-violation':18,'deny-then-answer':19,'two-answers':11};
    if(c.id in scores)assert.equal(actual.state.llmCompletion.threatState.score,scores[c.id]);
    if(c.id==='ingress-violation')assert.equal(actual.promptBindings.length,0);
    assert.equal(actual.toolCalls,1);
    for(const r of actual.requests.slice(2)) {
      assert.deepEqual(r,{messages:[{role:'system',content:system},{role:'assistant',content:'Finished 🧪'},{role:'user',content:'Explain the completed result.'}],tools:[]});
      assert.equal(JSON.stringify(r).includes('HOST_THREAT_ONLY'),false);assert.equal(JSON.stringify(r).includes('test-owner'),false);
    }
    for(const r of actual.receipts.filter(r=>r.scoped.outcome==='violation')) {
      assert.equal(r.output,null);assert.equal(r.scoped.signal.signal,'post_completion_violation');assert.equal(r.scoped.signal.kind,'hard');
      assert.deepEqual(Object.keys(r.scoped.signal).sort(),['at','inputDigest','kind','phase','signal']);
    }
    for(const b of actual.boundaries)assert.equal(b.binding.threatDigest,bindingDigest(b.data.threatState));
    for(const s of actual.steps)if(s.code!=='OK')assert.equal(s.value,undefined);
  }
});
test('private commands validate against schema, cannot reopen or bypass completion policy',async()=>{
  const f=await fixture();
  try {
    await f.loop.run('test-owner',f.session.sessionId,{message:'Explain.'},f.options);
    for(const command of f.commands)assert.equal(validate(command),true,JSON.stringify(validate.errors));
    const command=f.commands.at(-1),receipt=await f.store.execute(f.actor,command);
    assert.equal(receipt.scoped.turnCount,1);
    const legacy=new WorkflowStore(f.backend,{resumeSecret:new Uint8Array(32).fill(7),authorizePersistence:()=>true,durableTurns:true});
    await assert.rejects(legacy.execute(f.actor,command),{code:'INVALID_COMMAND'});
    await assert.rejects(f.store.execute(f.actor,{...command,state:{reopened:true}}),{code:'INVALID_COMMAND'});
    await assert.rejects(f.store.execute(f.actor,{...command,requestId:'next',expectedVersion:3,scopeDigest:'0'.repeat(64)}),{code:'STATE_CONFLICT'});
    await assert.rejects(f.update(),{code:'STATE_CONFLICT'});
    for(const status of ['running','completed'])await assert.rejects(f.store.execute(f.actor,{action:'updateSession',requestId:'reopen',sessionId:f.session.sessionId,expectedVersion:3,nodeId:'entry',nodeVersion:'1',policyVersion:'policy-1',status,state:{}}),{code:'INVALID_TRANSITION'});
    for(const key of ['inputDigest','scopeDigest'])for(const digest of ['0'.repeat(63)+'\n','0'.repeat(65),'A'.repeat(64)]) {
      assert.equal(validate({...command,[key]:digest}),false);
      await assert.rejects(f.store.execute(f.actor,{...command,[key]:digest}),{code:'INVALID_COMMAND'});
    }
    const next=await f.store.execute(f.actor,{action:'createSession',requestId:'seed-second',nodeId:'entry',nodeVersion:'1',policyVersion:'policy-1',expiresAt:2000,state:{}}),initial=f.commands[0];
    const continuing={...initial,requestId:'continue',sessionId:next.sessionId,complete:false,scope:null,threatState:null};
    assert.equal(validate(continuing),true);assert.equal((await f.store.execute(f.actor,continuing)).status,'running');
    assert.equal((await f.store.execute(f.actor,{...initial,sessionId:next.sessionId,requestId:'complete-second',expectedVersion:2})).scoped.outcome,'completion');
    await assert.rejects(f.gate.listTools('test-owner',f.session.sessionId,f.options),{code:'INACTIVE_SESSION'});
  }finally{f.close();}
});
test('SQL receipt failure rolls back threat state and violation counters',async()=>{
  const f=await fixture(),db=new DatabaseSync(join(f.directory,'state.sqlite'));
  try {
    db.exec("CREATE TRIGGER fail_scoped BEFORE INSERT ON psp_records WHEN NEW.kind='receipt' BEGIN SELECT RAISE(ABORT,'synthetic failure'); END;");
    f.flags.denyIngress=true;
    await assert.rejects(f.loop.run('test-owner',f.session.sessionId,{message:'Outside scope.'},f.options),{code:'HOST_ERROR'});
    const state=await f.store.execute(f.actor,{action:'getSession',sessionId:f.session.sessionId});
    assert.equal(state.version,2);assert.equal(state.llmCompletion.threatState.score,7);assert.equal(state.llmCompletion.violationCount,0);
    await assert.rejects(f.store.execute(f.actor,{action:'getTurn',sessionId:f.session.sessionId,requestId:'scope-1'}),{code:'NOT_FOUND'});
    db.exec('DROP TRIGGER fail_scoped');
    await assert.rejects(f.loop.run('test-owner',f.session.sessionId,{message:'Outside scope.'},f.options),{code:'PSP_POST_COMPLETION_VIOLATION'});
    assert.equal((await f.store.execute(f.actor,{action:'getSession',sessionId:f.session.sessionId})).llmCompletion.threatState.score,17);
  }finally{db.close();f.close();}
});
test('boundary reservation blocks competing writers; cancellation stores no signal',async()=>{
  const f=await fixture();let entered,release;
  const ready=new Promise(r=>{entered=r;}),waiting=new Promise(r=>{release=r;}),boundary=f.host.scopeBoundary;
  f.host.scopeBoundary=async(...args)=>{entered();await waiting;return boundary(...args);};
  const pending=f.loop.run('test-owner',f.session.sessionId,{message:'Explain.'},f.options);
  try {
    await ready;await assert.rejects(f.update(),{code:'STATE_BUSY'});f.baseFlags.cancelled=true;release();
    await assert.rejects(pending,{code:'CANCELLED'});assert.equal(records(f).find(r=>r.status).version,2);
  }finally{release();await pending.catch(()=>{});f.close();}
});
