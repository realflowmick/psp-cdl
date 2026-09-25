// SPDX-License-Identifier: Apache-2.0
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import {suite,runCase,fixture} from '../../../../../scripts/lifecycle-fixtures.mjs';
import {WorkflowService} from '../dist/workflow.js';
import {handleHttp} from '../dist/http.js';
const ajv=new Ajv2020({strict:false}),schemas=JSON.parse(readFileSync(new URL('../../../../../schemas/api/lifecycle-0.1.openapi.json',import.meta.url))).components.schemas;
for(const c of suite.cases)for(const mode of ['http','mcp'])test('lifecycle '+mode+': '+c.id,async()=>{
  await runCase(c,mode,(step,status,body)=>{const schema=schemas[status===200?step.operation+'Response':'Error'];if(schema)assert(ajv.validate(schema,body),JSON.stringify(ajv.errors));});
});
test('keyset pages return each owner session once without state; old services do not expose lifecycle',async()=>{
  const f=await fixture();try{
    for(let i=0;i<5;i++)await f.service.invoke('createSession',{requestId:'extra-'+i,nodeId:'entry',nodeVersion:'1',expiresAt:2000,state:{stage:'synthetic'}},'test-owner');
    const seen=new Set();let after=null;
    do{const {result}=await f.service.invoke('listSessions',{after,limit:2,status:'all'},'test-owner');for(const r of result.sessions){assert(!seen.has(r.sessionId));seen.add(r.sessionId);assert.deepEqual(Object.keys(r).sort(),['expiresAt','sessionId','status','updatedAt','version']);}after=result.after;}while(after);
    assert.equal(seen.size,6);
    const r=await handleHttp(new WorkflowService(f.store,f.host),{method:'POST',path:'/v1/sessions/list',headers:[['authorization','Bearer test-owner'],['content-type','application/json']],body:Buffer.from('{"after":null,"limit":1,"status":"all"}')});assert.equal(r.status,404);
  }finally{f.close();}
});
test('cleanup removes stored state and receipts without permitting request resurrection',async()=>{
  const f=await fixture();try{
    const sessionId=f.refs['@session'];await f.service.invoke('cancelSession',{requestId:'cancel',sessionId,expectedVersion:1},'test-owner');
    const r=await f.service.invoke('purgeSession',{requestId:'purge',sessionId,expectedVersion:2},'test-owner');assert.equal(r.result.more,false);
    assert(!('state' in f.backend.read(f.actor.tenantId,{kind:'session',id:sessionId}).body));
    assert.equal(f.backend.cleanupCandidate(f.actor,sessionId).record,null);
    await assert.rejects(()=>f.store.execute(f.actor,{action:'createSession',requestId:'seed',nodeId:'entry',nodeVersion:'1',policyVersion:'policy-1',expiresAt:2000,state:{stage:'initial',hidden:'PRIVATE_STATE'}}),{code:'RECEIPT_RETIRED'});
  }finally{f.close();}
});
