// SPDX-License-Identifier: Apache-2.0
// Synthetic host for tests/examples only. Its fixed credentials are public test data.
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {WorkflowStore} from '@psp-cdl/api-server/persistence';
import {SqliteBackend} from '@psp-cdl/api-server/sqlite';
import {WorkflowService} from '@psp-cdl/api-server/workflow';
import {SessionOperations} from '@psp-cdl/api-server/operations';
import {handleHttp} from '@psp-cdl/api-server/http';
import {suite as securitySuite} from './service-fixtures.mjs';
export const suite=JSON.parse(readFileSync(new URL('../conformance/vectors/workflows/service-0.1.json',import.meta.url),'utf8'));
export const routes={createSession:'/v1/sessions/create',getSession:'/v1/sessions/get',updateSession:'/v1/sessions/update',getNode:'/v1/nodes/fetch',createCheckpoint:'/v1/checkpoints/create',resumeCheckpoint:'/v1/checkpoints/resume',evaluate:'/v1/policy/evaluate'};
const scopes=['sessions:write','sessions:read','nodes:read','checkpoints:write','checkpoints:resume','policy:evaluate','security:verify'];
export async function fixture() {
  const directory=mkdtempSync(join(tmpdir(),'psp-workflow-'));
  const flags={now:1000,policy:'policy-1',persist:true,allowResume:true},tokens=new Map();
  const actor={tenantId:'tenant-a',subjectId:'subject-a'},principal={...actor,scopes};
  const backend=new SqliteBackend(join(directory,'state.sqlite'),'epoch-1',()=>flags.now);
  const store=new WorkflowStore(backend,{resumeSecret:Buffer.alloc(32,7),authorizePersistence:()=>flags.persist});
  for(const nodeId of ['entry','next']) await store.execute(actor,{action:'putNode',nodeId,nodeVersion:'1',definition:{stage:nodeId,hidden:'PRIVATE_STATE'}});
  const seed=await store.execute(actor,{action:'createSession',requestId:'seed',nodeId:'entry',nodeVersion:'1',policyVersion:'policy-1',expiresAt:2000,state:{stage:'initial',hidden:'PRIVATE_STATE'}});
  const refs={'@session':seed.sessionId};
  const host={
    now:()=>flags.now,
    authenticate:token=>flags.revoked?null:token==='test-owner'?principal:token==='test-reader'?{...principal,scopes:['sessions:read','nodes:read']}:
      token==='test-other'?{...principal,subjectId:'other'}:token==='test-tenant'?{...principal,tenantId:'other'}:null,
    policyVersion:()=>flags.policy,
    authorize:async(p,c)=>{
      if(flags.throwAuthorize) throw new Error('PRIVATE_BACKEND_DETAIL');
      if(flags.revokeOnAuthorize) flags.revoked=true;
      if(flags.changePolicyOnAuthorize) flags.policy='policy-2';
      if(flags.raceOnAuthorize&&c.current&&c.command.action==='updateSession') {
        flags.raceOnAuthorize=false;
        await store.execute(actor,{action:'updateSession',requestId:'racer',sessionId:seed.sessionId,expectedVersion:c.current.version,nodeId:'entry',nodeVersion:'1',policyVersion:'policy-1',status:'running',state:{stage:'racer'}});
      }
      if(flags.mutateGuard) {c.command.state={stage:'tampered'};c.result.state={stage:'tampered'};if(c.current)c.current.version=99;}
      if(flags.truthy) return 'yes';
      return !flags.deny&&!(flags.denyReplay&&c.replay)&&!(c.command.action==='resumeCheckpoint'&&!flags.allowResume);
    },
    present:(_p,_op,data)=>({stage:data.stage??'empty'}),
    deliverCheckpoint:(p,c)=>{if(flags.deliverFail)throw new Error('PRIVATE_BACKEND_DETAIL');tokens.set(JSON.stringify([p.tenantId,p.subjectId,c.checkpointId]),c.resumeToken);},
    resumeToken:(p,id)=>tokens.get(JSON.stringify([p.tenantId,p.subjectId,id]))??null,
    snapshot:()=>({expires:1900,verification:{keys:[],context:{},allowedAttributes:[]},resources:[{...structuredClone(securitySuite.snapshot.resources[0]),capabilities:[]}]}),
    resolve:(p,id)=>operations.resolve(p,id)
  };
  const operations=new SessionOperations(store,host),service=new WorkflowService(store,host);
  const replace=value=>typeof value==='string'?(refs[value]??value):Array.isArray(value)?value.map(replace):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).map(([k,v])=>[k,replace(v)])):value;
  const normalize=value=>typeof value==='string'?(Object.entries(refs).find(([,v])=>v===value)?.[0]??value):Array.isArray(value)?value.map(normalize):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).map(([k,v])=>[k,normalize(v)])):value;
  const capture=(step,body)=>{if(step.capture)refs[step.capture]=body.result[step.operation==='createCheckpoint'?'checkpointId':'sessionId'];};
  return {service,store,backend,host,operations,flags,actor,principal,refs,replace,normalize,capture,
    request:step=>({method:'POST',path:routes[step.operation],headers:[['authorization','Bearer '+(step.token??'test-owner')],['content-type','application/json']],body:Buffer.from(JSON.stringify(replace(step.request)))}),
    close:()=>{backend.close();rmSync(directory,{recursive:true,force:true});}};
}
export async function runCase(c,observe) {
  const f=await fixture(),report=[];
  try {
    for(const step of c.steps) {
      Object.assign(f.flags,step.flags??{});
      if(step.issue) {f.refs[step.issue]=await f.operations.issue(f.principal,f.refs['@session'],1800);continue;}
      const response=await handleHttp(f.service,f.request(step)),body=JSON.parse(response.body);
      if(observe) await observe(step,response,body);
      f.capture(step,body);
      const state=f.backend.read('tenant-a',{kind:'session',id:f.refs['@session']}).body;
      report.push({status:response.status,body:f.normalize(body),version:state.version,state:state.state.stage,statusAfter:state.status});
    }
    return report;
  } finally {f.close();}
}
