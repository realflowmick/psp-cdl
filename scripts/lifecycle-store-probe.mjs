// SPDX-License-Identifier: Apache-2.0
import {readFileSync} from 'node:fs';
import {SqliteBackend} from '@psp-cdl/api-server/sqlite';
import {LifecycleStore} from '@psp-cdl/api-server/lifecycle';
const backend=new SqliteBackend(process.argv[2],'epoch-1',()=>1000),actor={tenantId:'tenant-a',subjectId:'subject-a'};
const store=new LifecycleStore(backend,{resumeSecret:Buffer.alloc(32,7),authorizePersistence:()=>true,authorizeRetention:()=>true});
try{
  const c=JSON.parse(readFileSync(0,'utf8'));let result;
  if(c.operation==='seed'){
    await store.execute(actor,{action:'putNode',nodeId:'entry',nodeVersion:'1',definition:{}});
    result=await store.execute(actor,{action:'createSession',requestId:'seed',nodeId:'entry',nodeVersion:'1',policyVersion:'policy-1',expiresAt:2000,state:{payload:'SYNTHETIC_PAYLOAD'}});
    if(c.waiting)result={...result,checkpoint:await store.execute(actor,{action:'createCheckpoint',requestId:'cp',sessionId:result.sessionId,expectedVersion:1,expiresAt:1500})};
  }else if(c.operation==='execute')result=await store.execute(actor,c.command);
  else if(c.operation==='read')result=backend.read(actor.tenantId,{kind:'session',id:c.sessionId});
  else result=await store.lifecycle(actor,c.operation,c.command,()=>true);
  console.log(JSON.stringify({result}));
}catch(e){console.log(JSON.stringify({error:e.code??'INTERNAL_ERROR'}));}finally{backend.close();}
