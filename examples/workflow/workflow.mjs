// SPDX-License-Identifier: Apache-2.0
// A disposable synthetic host, not an authentication or business-policy implementation.
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {WorkflowStore} from '@psp-cdl/api-server/persistence';
import {SqliteBackend} from '@psp-cdl/api-server/sqlite';
import {WorkflowService} from '@psp-cdl/api-server/workflow';
import {handleHttp} from '@psp-cdl/api-server/http';

const directory=mkdtempSync(join(tmpdir(),'psp-example-'));
const now=()=>Math.floor(Date.now()/1000),credential=randomBytes(32).toString('hex');
const actor={tenantId:'synthetic-tenant',subjectId:'synthetic-owner'};
const principal={...actor,scopes:['sessions:read','sessions:write','checkpoints:write','checkpoints:resume']};
const backend=new SqliteBackend(join(directory,'workflow.sqlite'),'demo-epoch',now);
const store=new WorkflowStore(backend,{resumeSecret:randomBytes(32),authorizePersistence:()=>true}); // Synthetic data only.
const checkpoints=new Map();let approvalGranted=false;
const host={
  authenticate:token=>token===credential?principal:null,
  now,resolve:()=>null,policyVersion:()=> 'demo-policy-1',
  authorize:(_p,{command,current,replay})=>{
    if(command.action==='resumeCheckpoint')return approvalGranted;
    if(replay)return true; // Owner was checked by the store; this only permits an acknowledgement.
    if(command.action==='createSession')return command.nodeId==='entry';
    if(command.action==='updateSession')return current.nodeId==='entry'&&command.nodeId==='review';
    return command.action==='getSession'||(command.action==='createCheckpoint'&&current.nodeId==='review');
  },
  present:(_p,_operation,state)=>({stage:state.stage}),
  deliverCheckpoint:(p,c)=>checkpoints.set(JSON.stringify([p.tenantId,p.subjectId,c.checkpointId]),c.resumeToken),
  resumeToken:(p,id)=>checkpoints.get(JSON.stringify([p.tenantId,p.subjectId,id]))??null
};
const service=new WorkflowService(store,host);
async function call(route,args,expected=200) {
  const response=await handleHttp(service,{method:'POST',path:'/v1/'+route,headers:[['authorization','Bearer '+credential],['content-type','application/json']],body:Buffer.from(JSON.stringify(args))});
  assert.equal(response.status,expected,response.body);return JSON.parse(response.body);
}
try {
  for(const nodeId of ['entry','review'])await store.execute(actor,{action:'putNode',nodeId,nodeVersion:'1',definition:{label:nodeId}});
  const created=await call('sessions/create',{requestId:'create',nodeId:'entry',nodeVersion:'1',expiresAt:now()+600,state:{stage:'created'}});
  const sessionId=created.result.sessionId;
  const saved=await call('sessions/update',{requestId:'save',sessionId,expectedVersion:1,nodeId:'review',nodeVersion:'1',status:'running',state:{stage:'saved'}});
  const paused=await call('checkpoints/create',{requestId:'pause',sessionId,expectedVersion:2,expiresAt:now()+300});
  const command={requestId:'resume',checkpointId:paused.result.checkpointId,state:{stage:'resumed'}};
  const denied=await call('checkpoints/resume',command,403);
  // A trusted application interaction grants approval; no submitted "approved" field can do this.
  approvalGranted=true;
  const resumed=await call('checkpoints/resume',command);
  assert.deepEqual(await call('checkpoints/resume',command),resumed);
  console.log(JSON.stringify({created:created.result.version,saved:saved.result.version,paused:paused.result.sessionVersion,denied:denied.error.code,resumed:resumed.result.version,view:resumed.result.view}));
} finally {backend.close();rmSync(directory,{recursive:true,force:true});}
