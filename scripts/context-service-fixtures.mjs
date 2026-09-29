// SPDX-License-Identifier: Apache-2.0
// Public synthetic host. No live model calls or production credentials.
import {readFileSync} from 'node:fs';
import {fixture} from './llm-fixtures.mjs';
import {WorkflowService} from '@psp-cdl/api-server/workflow';
import {WorkflowStore} from '@psp-cdl/api-server/persistence';
import {ContextLlmLoop,CONTEXT_SERVICE_PROFILE} from '@psp-cdl/llmproxy';
import {bindingDigest} from '@psp-cdl/mcpproxy';
export const suite=JSON.parse(readFileSync(new URL('../conformance/vectors/llm/context-service-0.1.json',import.meta.url),'utf8'));
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8').replaceAll('\r\n','\n');
export const configuration={profile:CONTEXT_SERVICE_PROFILE,
  pspInstructions:read('specs/systemprompts/PSP-Core-v3_2_0-Interpreter-draft-0_1.md'),
  cdlInstructions:read('specs/systemprompts/CDL-v1_5-Interpreter-draft-0_1.md'),
  application:read('examples/in-context/application.psp'),serviceSources:[{id:'workflow',capabilities:[]}],serviceComplete:true};
export async function runCase(c) {
  const flags=c.flags??{},responses=c.proposals.map(p=>({type:'final',text:typeof p==='string'?p:JSON.stringify(p)}));
  if(flags.readFirst)responses.unshift({type:'tool',name:'echo.read',arguments:{message:'synthetic read'}});
  if(flags.resume)responses.push({type:'final',text:JSON.stringify({type:'answer',text:'Resumed from the persisted state.'})});
  const f=await fixture({...flags,responses}),tokens=new Map();
  let code='OK',result;
  try {
    for(const nodeId of ['help','survey'])await f.store.execute(f.actor,{action:'putNode',nodeId,nodeVersion:'1',definition:{agents:'mcp://echo/read',instructions:'Keep full application context.'}});
    f.baseFlags.denyPersistence=!!flags.denyPersistence;
    const auth=f.loopHost.authenticate;
    const host={...f.loopHost,authenticate:t=>{const p=auth(t);return p?{...p,scopes:[...p.scopes,'sessions:read','sessions:write','nodes:read','checkpoints:write','checkpoints:resume']}:null;},
      signContext:(p,b,text)=>{f.flags.promptText=text;return f.loopHost.prompt(p,b);},
      policy:(p,b,d,phase)=>flags.denyService&&d.service?{bindingDigest:bindingDigest(b),resources:[{classes:[],covenants:['no-persist'],capabilities:[],checks:{},parameters:{},context:{}}]}:f.loopHost.policy(p,b,d,phase)};
    const service=new WorkflowService(f.store,{...host,resolve:()=>null,policyVersion:()=> 'policy-1',
      authorize:async(_p,c)=>{
        if(flags.resumeDenied&&c.command.action==='resumeCheckpoint')return false;
        if(c.command.action==='updateSession') {
          if(flags.revokeService)f.baseFlags.revoked=true;
          if(flags.cancelService)f.baseFlags.cancelled=true;
          if(flags.driftService)f.baseFlags.drift=true;
          if(flags.raceService){
            const other=new WorkflowStore(f.backend,{resumeSecret:new Uint8Array(32).fill(7),authorizePersistence:()=>true});
            await other.execute(f.actor,{action:'updateSession',requestId:'other-worker',sessionId:f.session.sessionId,expectedVersion:1,nodeId:'entry',nodeVersion:'1',policyVersion:'policy-1',status:'running',state:{stage:'concurrent'}});
          }
          if(flags.denyWrite||flags.denyHelp&&c.command.nodeId==='help')return false;
        }
        return true;
      },
      present:(_p,operation,data)=>{if(flags.projectionFail&&operation==='updateSession')throw new Error('PRIVATE_SERVICE_DETAIL');return data;},
      deliverCheckpoint:(_p,data)=>{if(flags.deliverFail)throw new Error('PRIVATE_SERVICE_DETAIL');tokens.set(data.checkpointId,data.resumeToken);},
      resumeToken:(_p,id)=>tokens.get(id)??null});
    const make=()=>new ContextLlmLoop(f.store,f.gate,host,f.provider,service,configuration);
    result=await make().run('test-owner',f.session.sessionId,{message:'Please review my situation.'},{...f.options,requestId:'context-turn',maxRounds:flags.maxRounds??4});
    if(flags.resume) {
      const state=await f.store.execute(f.actor,{action:'getSession',sessionId:f.session.sessionId});
      result=await make().resumeAndRun('test-owner',flags.resumeWrongSession?'wrong-session':f.session.sessionId,{requestId:'host-resume',checkpointId:result.receipt.result.result.checkpointId,state:state.state},{message:'Continue after the approved resume.'},{...f.options,requestId:'resumed-turn',maxRounds:4});
    }
  }catch(e){code=e.code??'UNEXPECTED_ERROR';}
  try {
    const state=f.backend.read(f.actor.tenantId,{kind:'session',id:f.session.sessionId}).body;
    const last=f.requests.at(-1),events=[];let rehydrated=false;
    for(const m of last?.messages??[])if(m.role==='user')try {
      const v=JSON.parse(m.content);
      if(v.event?.startsWith('service-'))events.push(v.event);
      if(v.event==='session-view'&&v.data.result.version===4&&v.data.result.view.current_node==='help')rehydrated=true;
    }catch{}
    const wire=JSON.stringify(f.requests);
    return {code,calls:f.requests.length,toolCalls:f.stats().toolCalls,version:state.version,node:state.nodeId,status:state.status,state:state.state,events,rehydrated,
      hasCandidates:f.requests.every(r=>r.messages[0].content.includes(configuration.pspInstructions)&&r.messages[0].content.includes(configuration.cdlInstructions)&&r.messages[0].content.endsWith(configuration.application)),
      hasToolHistory:!!last?.messages.some(m=>m.role==='tool'),
      privateLeak:['test-owner','test-signing-key','tenant-a','subject-a','PRIVATE_SERVICE_DETAIL',...tokens.values()].some(s=>wire.includes(s))};
  }finally{f.close();}
}
