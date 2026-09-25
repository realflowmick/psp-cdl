// SPDX-License-Identifier: Apache-2.0
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {fixture as workflowFixture,routes as workflowRoutes} from './workflow-fixtures.mjs';
import {LifecycleStore,LifecycleService} from '@psp-cdl/api-server/lifecycle';
import {handleHttp} from '@psp-cdl/api-server/http';
import {McpServer} from '@psp-cdl/mcp-server';
import {evaluateBatch} from '@psp-cdl/cdl';
export const suite=JSON.parse(readFileSync(new URL('../conformance/vectors/workflows/lifecycle-0.1.json',import.meta.url)));
export const routes={...workflowRoutes,listSessions:'/v1/sessions/list',cancelSession:'/v1/sessions/cancel',purgeSession:'/v1/sessions/purge'};
export async function fixture(){
  const f=await workflowFixture();f.flags.retention=true;f.principal.scopes=[...f.principal.scopes,'sessions:cancel','sessions:purge'];
  f.store=new LifecycleStore(f.backend,{resumeSecret:Buffer.alloc(32,7),authorizePersistence:()=>f.flags.persist,authorizeRetention:()=>f.flags.retention&&(f.flags.retentionCdlConflict?evaluateBatch([{classes:[],covenants:['no-persist','no-log'],capabilities:['logs-operations'],checks:{},parameters:{},context:{}}]).decision==='allow':true)});
  f.service=new LifecycleService(f.store,f.host);
  const authorize=f.host.authorize;
  f.host.authorize=async(p,c)=>{
    if(c.command.action==='getSession'&&f.flags.purgeOnRead){f.flags.purgeOnRead=false;await f.store.lifecycle(f.actor,'purgeSession',{requestId:'read-race',sessionId:f.refs['@session'],expectedVersion:c.current.version},()=>true);}
    if(c.command.action==='cancelSession'&&f.flags.winUpdate){f.flags.winUpdate=false;await f.store.execute(f.actor,{action:'updateSession',requestId:'winner',sessionId:f.refs['@session'],expectedVersion:1,nodeId:'entry',nodeVersion:'1',policyVersion:'policy-1',status:'running',state:{stage:'winner'}});}
    if(c.command.action==='cancelSession'&&f.flags.winResume){f.flags.winResume=false;await f.service.invoke('resumeCheckpoint',{requestId:'winner',checkpointId:f.refs['@cp'],state:{}},'test-owner');}
    return authorize(p,c);
  };
  return f;
}
export async function runCase(c,mode='http',observe){
  const f=await fixture(),report=[];let token='test-owner';
  
  try{
    for(const step of c.steps){
      Object.assign(f.flags,step.flags??{});
      if(step.issue){f.refs[step.issue]=await f.operations.issue(f.principal,f.refs['@session'],1800);continue;}
      token=step.token??'test-owner';let status,body;
      if(mode==='http'){
        const response=await handleHttp(f.service,{...f.request(step),path:routes[step.operation]});status=response.status;body=JSON.parse(response.body);
      }else{
        // A fresh authenticated transport for each owner; no identity switching on an initialized peer.
        const peer=new McpServer(f.service,()=>token);
        await peer.handle(JSON.stringify({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'test',version:'1'}}}));
        await peer.handle(JSON.stringify({jsonrpc:'2.0',method:'notifications/initialized'}));
        const r=await peer.handle(JSON.stringify({jsonrpc:'2.0',id:2,method:'tools/call',params:{name:'realflow.'+routes[step.operation].slice(4).replaceAll('/','.'),arguments:f.replace(step.request)}}));
        body=r.result?.structuredContent??(r.result?.content?JSON.parse(r.result.content[0].text):{error:{code:r.error.message}});status=body.error?step.expect.status:200;
      }
      assert.equal(status,step.expect.status,c.id);if(step.expect.error)assert.equal(body.error.code,step.expect.error,c.id);
      if(observe)observe(step,status,body);
      f.capture(step,body);
      const s=f.backend.read(f.actor.tenantId,{kind:'session',id:f.refs['@session']}).body;
      for(const [k,actual] of Object.entries({state:s.status,version:s.version,count:body.result?.sessions?.length,cleaned:body.result?.cleaned,more:body.result?.more}))if(k in step)assert.deepEqual(actual,step[k],c.id+':'+k);
      assert(!JSON.stringify(body).includes('PRIVATE_'));assert(!JSON.stringify(body).includes('resumeToken'));
      report.push({status,body:f.normalize(body),version:s.version,state:s.status});
    }
    return report;
  }finally{f.close();}
}
