// SPDX-License-Identifier: Apache-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {WorkflowStore} from '../dist/persistence.js';
import {SqliteBackend} from '../dist/sqlite.js';
import {STORAGE_SCHEMA} from '../dist/storage-schema.js';
import {fixture,runFixture,secret} from '../../../../../scripts/persistence-fixtures.mjs';
const actor=fixture.actor;
const node=fixture.steps.find(s=>s.id==='node').command;
const create=fixture.steps.find(s=>s.id==='session').command;
async function withStore(fn) {
  const dir=mkdtempSync(join(tmpdir(),'psp-storage-')),path=join(dir,'state.sqlite');
  let now=100,permit=()=>true;
  const b=new SqliteBackend(path,'epoch-1',()=>now),s=new WorkflowStore(b,{resumeSecret:secret,authorizePersistence:(...a)=>permit(...a)});
  try {await fn({s,b,path,setTime:n=>now=n,setPermit:p=>permit=p});}
  finally {b.close();rmSync(dir,{recursive:true,force:true});}
}
test('shared persistence vectors, real file reopen and byte-preserving JSON',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'psp-vectors-'));
  try {assert.equal((await runFixture(join(dir,'state.sqlite'))).length,fixture.steps.filter(s=>!s.control).length);}
  finally {rmSync(dir,{recursive:true,force:true});}
});
test('packaged schema matches the shared contract',()=>assert.equal(STORAGE_SCHEMA,readFileSync(new URL('../../../../../schemas/persistence/sqlite-0.1.sql',import.meta.url),'utf8')));
test('SQL failure rolls back token consumption, session change and receipt together',()=>withStore(async({s,path})=>{
  await s.execute(actor,node);const session=await s.execute(actor,create);
  const cp=await s.execute(actor,{action:'createCheckpoint',requestId:'cp',sessionId:session.sessionId,expectedVersion:1,expiresAt:150});
  const raw=new DatabaseSync(path);
  try {
    raw.exec("CREATE TRIGGER synthetic_failure BEFORE INSERT ON psp_records WHEN NEW.kind='receipt' BEGIN SELECT RAISE(ABORT,'public synthetic fault'); END;");
    const command={action:'resumeCheckpoint',requestId:'resume',checkpointId:cp.checkpointId,resumeToken:cp.resumeToken,state:{done:true}};
    await assert.rejects(()=>s.execute(actor,command),{code:'STORE_FAILURE'});
    assert.equal((await s.execute(actor,{action:'getSession',sessionId:session.sessionId})).status,'waiting');
    assert.equal(JSON.parse(raw.prepare("SELECT body FROM psp_records WHERE kind='checkpoint'").get().body).consumed,false);
    raw.exec('DROP TRIGGER synthetic_failure');
    assert.equal((await s.execute(actor,command)).version,3);
    const bytes=readFileSync(path);assert(!bytes.includes(Buffer.from(cp.resumeToken)));
  } finally {raw.close();}
}));
test('expiry at commit rolls back all writes; policy receives isolated copies',()=>withStore(async({s,b,setTime,setPermit})=>{
  await s.execute(actor,node);
  setPermit((_actor,writes)=>{writes[0].body.state={tampered:true};setTime(200);return true;});
  await assert.rejects(()=>s.execute(actor,create),{code:'EXPIRED'});
  setTime(100);setPermit((_actor,writes)=>{writes[0].body.state={tampered:true};return true;});
  const session=await s.execute(actor,create);assert.deepEqual(session.state,create.state);
  const clone=await b.read(actor.tenantId,{kind:'session',id:session.sessionId});clone.body.state={tampered:true};
  assert.deepEqual((await s.execute(actor,{action:'getSession',sessionId:session.sessionId})).state,create.state);
}));
test('denied storage includes metadata; truthy values and throwing guards fail closed',()=>withStore(async({s,setPermit,path})=>{
  for(const guard of [()=> 'true',()=>{throw Error('private details');},()=>false]) {
    setPermit(guard);await assert.rejects(()=>s.execute(actor,node),{code:'PERSISTENCE_DENIED'});
  }
  const raw=new DatabaseSync(path);try {assert.equal(raw.prepare('SELECT count(*) AS n FROM psp_records').get().n,0);} finally {raw.close();}
}));
test('strict state bounds and invalid commands do not write',()=>withStore(async({s})=>{
  for(const state of [{big:'x'.repeat(1_048_576)},{bad:NaN},{get bad(){throw Error('must not invoke');}}])
    await assert.rejects(()=>s.execute(actor,{...create,state}),{code:'INVALID_STATE'});
  for(const action of ['constructor','__proto__','toString']) await assert.rejects(()=>s.execute(actor,{action}),{code:'INVALID_COMMAND'});
}));
test('epochs fence old records and key changes reject old tokens',()=>withStore(async({s,path})=>{
  await s.execute(actor,node);const session=await s.execute(actor,create);
  const cpCommand={action:'createCheckpoint',requestId:'cp',sessionId:session.sessionId,expectedVersion:1,expiresAt:150};
  const cp=await s.execute(actor,cpCommand);
  const b2=new SqliteBackend(path,'epoch-2',()=>100),b1=new SqliteBackend(path,'epoch-1',()=>100);
  try {
    const other=new WorkflowStore(b2,{resumeSecret:secret,authorizePersistence:()=>true});
    await assert.rejects(()=>other.execute(actor,{action:'getSession',sessionId:session.sessionId}),{code:'NOT_FOUND'});
    const rotated=new WorkflowStore(b1,{resumeSecret:new Uint8Array(32).fill(43),authorizePersistence:()=>true});
    await assert.rejects(()=>rotated.execute(actor,cpCommand),{code:'CHECKPOINT_KEY_CHANGED'});
    await assert.rejects(()=>rotated.execute(actor,{action:'resumeCheckpoint',requestId:'resume',checkpointId:cp.checkpointId,resumeToken:cp.resumeToken,state:{}}),{code:'INVALID_TOKEN'});
  } finally {b2.close();b1.close();}
}));
test('unsupported schema is rejected and batch writes require matched comparisons',()=>withStore(async({b,path})=>{
  assert.throws(()=>b.commit(actor.tenantId,[],[{kind:'session',id:'x',revision:1,body:{}}],200),{code:'INVALID_STATE'});
  const raw=new DatabaseSync(path);try {raw.exec('PRAGMA user_version=99');} finally {raw.close();}
  assert.throws(()=>new SqliteBackend(path,'epoch-1'),{code:'UNSUPPORTED_SCHEMA'});
  for(const path of [':memory:','file:test','']) assert.throws(()=>new SqliteBackend(path,'epoch-1'),{code:'INVALID_CONFIGURATION'});
}));
test('identical retry observes a winner between receipt miss and state read',()=>withStore(async({s,b})=>{
  await s.execute(actor,node);const session=await s.execute(actor,create);
  const cp=await s.execute(actor,{action:'createCheckpoint',requestId:'cp',sessionId:session.sessionId,expectedVersion:1,expiresAt:150});
  const command={action:'resumeCheckpoint',requestId:'resume',checkpointId:cp.checkpointId,resumeToken:cp.resumeToken,state:{done:true}};
  let armed=true,winner;
  const delayed={epoch:b.epoch,now:()=>b.now(),commit:(...args)=>b.commit(...args),read:async(tenant,key)=>{
    const prior=b.read(tenant,key);
    if(armed&&key.kind==='receipt'&&prior===null) {armed=false;winner=await s.execute(actor,command);}
    return prior;
  }};
  const peer=new WorkflowStore(delayed,{resumeSecret:secret,authorizePersistence:()=>true});
  assert.deepEqual(await peer.execute(actor,command),winner);
  assert.equal((await s.execute(actor,{action:'getSession',sessionId:session.sessionId})).version,3);
}));
