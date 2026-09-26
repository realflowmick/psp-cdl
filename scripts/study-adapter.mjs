// SPDX-License-Identifier: Apache-2.0
import {readFileSync,mkdtempSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {performance} from 'node:perf_hooks';
import {canonicalJson} from '@psp-cdl/core';
import {signEnvelope} from '@psp-cdl/core/crypto';
import {evaluatePolicy,aggregateCapabilities} from '@psp-cdl/cdl';
import {WorkflowStore,OwnerCoordinator} from '@psp-cdl/api-server/persistence';
import {SqliteBackend} from '@psp-cdl/api-server/sqlite';
import {McpDispatchGate,bindingDigest} from '@psp-cdl/mcpproxy';
import {StdioMcpClient} from '@psp-cdl/mcpproxy/mcp';
import {BufferedLlmLoop,promptContext,createOpenAIChatProvider,OPENAI_CHAT_MODEL,OPENAI_CHAT_INPUT_RESERVATION} from '@psp-cdl/llmproxy';
import {environment,credential,readEvents} from './topology-common.mjs';
import {caseInput,approval,resource,systemText,message} from './study-common.mjs';

const fail=code=>{throw Object.assign(Error(code),{code});};
export function offlineReply(input,step,request) {
  const action=input.offlineSteps[Math.min(step,input.offlineSteps.length-1)];
  const tool=action.tool?request.tools?.find(t=>t.function.description==='study.'+action.tool):null;
  const choice=tool?{finish_reason:'tool_calls',message:{role:'assistant',content:null,tool_calls:[{id:'synthetic_call',type:'function',function:{name:tool.function.name,arguments:'{}'}}]}}:
    {finish_reason:'stop',message:{role:'assistant',content:action.tool?'UNAVAILABLE':action.final}};
  return {id:'synthetic',object:'chat.completion',created:0,model:OPENAI_CHAT_MODEL,choices:[{index:0,...choice}],usage:{prompt_tokens:10,completion_tokens:5,total_tokens:15}};
}

export async function directLoop(provider,registrations,input,options,cdl,now) {
  const messages=[{role:'system',content:systemText},{role:'user',content:message(input)}];
  const tools=registrations.map(r=>({name:'study.'+r.name,inputSchema:r.inputSchema,outputSchema:r.outputSchema}));
  const check=()=>{if(options.cancelled())fail('CANCELLED');if(now()>=options.deadline)fail('DEADLINE_EXCEEDED');};
  const decide=caps=>{
    const covenants=input.noDisplay&&messages.some(m=>m.role==='tool'&&m.name==='study.private')?['no-display-to-operator']:[];
    const decision=evaluatePolicy({...resource(covenants),capabilities:caps}).decision;
    if(decision!=='allow')fail(decision==='unsupported'?'UNSUPPORTED_POLICY':'OUTPUT_DENIED');
  };
  for(let step=0;step<options.maxSteps;step++) {
    check();if(cdl)decide(aggregateCapabilities(provider.sources,true));
    const result=await provider.invoke(structuredClone({messages,tools}),{deadline:options.deadline,cancelled:options.cancelled});check();
    if(result.type==='final') {if(cdl)decide(['can-display-to-operator']);return result.text;}
    const tool=registrations.find(r=>'study.'+r.name===result.name);
    if(result.type!=='tool'||!tool||Object.keys(result.arguments).length)fail('INVALID_RESPONSE');
    if(step===options.maxSteps-1)fail('STEP_LIMIT');
    if(cdl)decide(aggregateCapabilities(tool.sources,true));
    const data=await tool.invoke(result.arguments,{deadline:options.deadline,cancelled:options.cancelled});check();
    messages.push({role:'assistant',call:{name:result.name,arguments:result.arguments}},{role:'tool',name:result.name,data});
  }
  fail('STEP_LIMIT');
}

export async function runTrial(config) {
  const input=caseInput(config.caseId),psp=['psp-only','combined'].includes(config.condition),cdl=['cdl-only','combined'].includes(config.condition);
  if(!['unprotected','psp-only','cdl-only','combined'].includes(config.condition)||!['offline','live'].includes(config.mode))fail('INVALID_CONFIGURATION');
  if(config.mode==='live'&&(config.allowLive!==true||config.reservedMicroUsd<=0))fail('LIVE_NOT_AUTHORIZED');
  const directory=mkdtempSync(join(tmpdir(),'psp-study-')),spy=join(directory,'events.jsonl');
  const started=performance.now(),now=()=>Math.floor(Date.now()/1000),expires=now()+120;
  const options={deadline:now()+60,cancelled:()=>existsSync(config.cancelFile),maxSteps:4};
  const requests=[],key=new Uint8Array(32).fill(19),actor={tenantId:'study-tenant',subjectId:'study-owner'};
  let peer,backend,session,providerCalls=0,providerError=null,output=null,code='OK',apiKey='';
  try {
    const providerConfig={mode:config.mode,now,complete:true,sources:config.sources,
      limits:{maxRequestBytes:65536,maxResponseBytes:65536,maxOutputTokens:128,maxCalls:4,budgetTokens:4*(OPENAI_CHAT_INPUT_RESERVATION+128),timeoutMs:15000}};
    let step=0;
    if(config.mode==='live'){apiKey=process.env.PSP_OPENAI_API_KEY??'';Object.assign(providerConfig,{allowLive:true,apiKey});}
    else providerConfig.transport=body=>({status:200,contentType:'application/json',body:Buffer.from(canonicalJson(offlineReply(input,step++,JSON.parse(Buffer.from(body).toString('utf8')))))});
    const raw=createOpenAIChatProvider(providerConfig);
    const provider={...raw,invoke:async(request,controls)=>{
      requests.push(structuredClone(request));providerCalls++;
      try{return await raw.invoke(request,controls);}catch(error){providerError=error.code??'PROVIDER_FAILED';throw error;}
    }};
    peer=await StdioMcpClient.connect({executable:config.peerExecutable,args:[config.peerScript,config.caseId,spy],env:environment(),serverInfo:{name:'psp-cdl-reference',version:'0.1.0'},timeoutMs:30000});
    const registrations=peer.registrations('study',['public','private'].map(approval),now);
    if(psp) {
      backend=new SqliteBackend(join(directory,'state.sqlite'),'study-epoch',now);
      const store=new WorkflowStore(backend,{resumeSecret:new Uint8Array(32).fill(7),authorizePersistence:()=>true,coordinator:new OwnerCoordinator()});
      await store.execute(actor,{action:'putNode',nodeId:'study',nodeVersion:'1',definition:{agents:input.allowedTools.map(t=>'mcp://study/'+t).join(',')}});
      session=await store.execute(actor,{action:'createSession',requestId:'study-seed',nodeId:'study',nodeVersion:'1',policyVersion:'study-policy',expiresAt:expires,state:{}});
      const host={now,authenticate:t=>t==='study-token'?{...actor,scopes:['tools:list','tools:call','models:invoke']}:null,
        snapshot:()=>({revision:'study-authority',policyVersion:'study-policy',registryRevision:'study-registry',expires,releaseSources:[{id:'model',capabilities:aggregateCapabilities(config.sources,true)}],releaseComplete:true}),
        policy:(_p,b)=>({bindingDigest:bindingDigest(b),resources:[resource([])]})};
      const gate=new McpDispatchGate(store,host,'study-registry',registrations);
      const loopHost={...host,snapshot:()=>({...host.snapshot(),providerId:provider.id,providerRevision:provider.revision,releaseSources:[{id:'display',capabilities:['can-display-to-operator']}]}),
        prompt:(_p,b)=>signEnvelope(systemText,{algorithm:'hmac-sha256',signatureVersion:'2.0',secretId:'study-key',timestamp:expires-120,expires,version:'1.0.0',sectionType:'system',contentType:'text',trustLevel:2,attributes:promptContext(b)},key),
        verification:()=>({keys:[{id:'study-key',algorithm:'hmac-sha256',material:key,status:'active',trustLevels:[2],sectionTypes:['system'],scope:{},allowUnscoped:false}]}),
        policy:(_p,b,data)=>({bindingDigest:bindingDigest(b),resources:[resource(cdl&&input.noDisplay&&data.request.messages.some(m=>m.role==='tool'&&m.name==='study.private')?['no-display-to-operator']:[])]}),
        authorizeFinal:()=>true};
      output=(await new BufferedLlmLoop(store,gate,loopHost,provider).run('study-token',session.sessionId,{message:message(input)},options)).text;
    }else output=await directLoop(provider,registrations,input,options,cdl,now);
  }catch(error){code=typeof error.code==='string'&&/^[A-Z_]{1,64}$/.test(error.code)?error.code:'ADAPTER_ERROR';}
  finally {try{await peer?.close();}finally{backend?.close();}}
  try {
    let events=[];
    try {events=existsSync(spy)?readEvents(spy,config.caseId,true):[];}
    catch {code='INVALID_OBSERVATION';output=null;}
    if(events[0]?.kind!=='isolation-probes-blocked'&&code==='OK'){code='ISOLATION_NOT_OBSERVED';output=null;}
    const serialized=canonicalJson(requests),privateValues=['study-tenant','study-owner','study-token','study-key',credential,session?.sessionId,apiKey].filter(Boolean);
    return {code,output,events,providerCalls,providerError,requestDigest:bindingDigest(requests),
      authorityLeak:privateValues.some(v=>serialized.includes(v)),elapsedMs:Math.round(performance.now()-started)};
  }finally {rmSync(directory,{recursive:true,force:true,maxRetries:20,retryDelay:50});}
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href) {
  try {console.log(JSON.stringify(await runTrial(JSON.parse(readFileSync(0,'utf8')))));}
  catch {console.log(JSON.stringify({error:'ADAPTER_ERROR'}));process.exitCode=1;}
}
