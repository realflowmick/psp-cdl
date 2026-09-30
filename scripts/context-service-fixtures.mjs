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
export async function runCase(c, options={}) {
  const flags={...c.flags},responses=c.proposals.map(p=>({type:'final',text:typeof p==='string'?p:JSON.stringify(p)}));
  if(flags.readFirst)responses.unshift({type:'tool',name:'echo.read',arguments:{message:'synthetic read'}});
  if(flags.resume)responses.push({type:'final',text:JSON.stringify({type:'answer',text:'Resumed from the persisted state.'})});
  const f=await fixture({...flags,responses,base:c.initialState?{initialState:c.initialState}:{}}),tokens=new Map();
  const config=options.configuration??configuration,trace=[],services=[],outputs=[];
  let code='OK',result,recoveryCode=null;
  const inner=options.provider??f.provider;
  const provider={...inner,invoke:async(request,controls)=>{
    if(options.provider)f.requests.push(structuredClone(request));
    const entry={request:structuredClone(request)};trace.push(entry);
    try {const response=await inner.invoke(request,controls);entry.response=structuredClone(response);return response;}
    catch(e){entry.code=e.code??'PROVIDER_FAILED';throw e;}
  }};
  const snapshot=f.loopHost.snapshot;
  f.loopHost.snapshot=(...args)=>({...snapshot(...args),providerId:provider.id,providerRevision:provider.revision});
  let service,make;
  try {
    for(const nodeId of ['help','survey'])await f.store.execute(f.actor,{action:'putNode',nodeId,nodeVersion:'1',definition:{agents:'mcp://echo/read',instructions:'Keep full application context.'}});
    f.baseFlags.denyPersistence=!!flags.denyPersistence;
    const auth=f.loopHost.authenticate;
    const host={...f.loopHost,authenticate:t=>{const p=auth(t);return p?{...p,scopes:[...p.scopes,'sessions:read','sessions:write','nodes:read','checkpoints:write','checkpoints:resume']}:null;},
      signContext:(p,b,text)=>{f.flags.promptText=text;return f.loopHost.prompt(p,b);},
      policy:(p,b,d,phase)=>flags.denyService&&d.service?{bindingDigest:bindingDigest(b),resources:[{classes:[],covenants:['no-persist'],capabilities:[],checks:{},parameters:{},context:{}}]}:f.loopHost.policy(p,b,d,phase)};
    service=new WorkflowService(f.store,{...host,resolve:()=>null,policyVersion:()=> 'policy-1',
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
      deliverCheckpoint:(_p,data)=>{if(flags.deliverFail)throw new Error('PRIVATE_SERVICE_DETAIL');tokens.set(data.checkpointId,data.resumeToken);if(flags.driftDelivery)f.baseFlags.drift=true;},
      resumeToken:(_p,id)=>tokens.get(id)??null});
    const invoke=service.invoke.bind(service);
    service.invoke=async(operation,...args)=>{
      const event={operation};services.push(event);
      try {const result=await invoke(operation,...args);event.result=structuredClone(result);return result;}
      catch(e){event.code=e.code??'HOST_ERROR';throw e;}
    };
    make=()=>new ContextLlmLoop(f.store,f.gate,host,provider,service,config);
    result=await make().run('test-owner',f.session.sessionId,{message:c.message??'Please review my situation.'},{...f.options,requestId:'context-turn',maxRounds:flags.maxRounds??4});
    outputs.push(result);
    if(flags.resume) {
      const state=await f.store.execute(f.actor,{action:'getSession',sessionId:f.session.sessionId});
      result=await make().resumeAndRun('test-owner',flags.resumeWrongSession?'wrong-session':f.session.sessionId,{requestId:'host-resume',checkpointId:result.receipt.result.result.checkpointId,state:state.state},{message:'Continue after the approved resume.'},{...f.options,requestId:'resumed-turn',maxRounds:4});
      outputs.push(result);
    }
  }catch(e){code=e.code??'UNEXPECTED_ERROR';}
  if(flags.reconcileAfterFailure&&code!=='OK'&&service&&make) {
    // Explicit test-host reconciliation, never a retry of the failed mutation.
    flags.projectionFail=false;
    try {
      await service.invoke('getSession',{sessionId:f.session.sessionId},'test-owner');
      result=await make().run('test-owner',f.session.sessionId,{message:'The prior response failed after a possible commit. The host has re-read durable state. Reconcile the current view; do not replay the write. Report the confirmed state and any unknown effects.'},{...f.options,requestId:'reconciled-turn',maxRounds:4});
      outputs.push(result);recoveryCode='OK';
    }catch(e){recoveryCode=e.code??'UNEXPECTED_ERROR';}
  }
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
      ...(options.capture?{trace,services,outputs,recoveryCode}:{}),
      hasCandidates:f.requests.every(r=>r.messages[0].content.includes(config.pspInstructions)&&r.messages[0].content.includes(config.cdlInstructions)&&r.messages[0].content.endsWith(config.application)),
      hasToolHistory:!!last?.messages.some(m=>m.role==='tool'),
      privateLeak:['test-owner','test-signing-key','tenant-a','subject-a','PRIVATE_SERVICE_DETAIL',...tokens.values()].some(s=>wire.includes(s))};
  }finally{f.close();}
}
