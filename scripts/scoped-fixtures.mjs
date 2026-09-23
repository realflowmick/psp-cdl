// SPDX-License-Identifier: Apache-2.0
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {join} from 'node:path';
import {fixture as durableFixture} from './durable-fixtures.mjs';
import {ScopedLlmLoop,scopedPromptContext} from '@psp-cdl/llmproxy';
import {signEnvelope} from '@psp-cdl/core/crypto';
import {bindingDigest} from '@psp-cdl/mcpproxy';
export const suite=JSON.parse(readFileSync(new URL('../conformance/vectors/llm/scoped-0.1.json',import.meta.url),'utf8'));
export const system='Discuss only the completed synthetic results.';
export async function fixture(settings={}) {
  const f=await durableFixture({base:{scopedTurns:!settings.disabledScoped}}),boundaries=[],promptBindings=[];
  const definition={postCompletion:'scoped',scope:{id:'results',version:'1',system:settings.emptySystem?'':system,threatPolicy:settings.explicitPolicy?{id:'restricted-threat',version:'2'}:null}};
  const provider={...f.provider,invoke:async(r,o)=>{
    const result=await f.provider.invoke(r,o);
    if(r.tools.length)return result;
    if(f.flags.scopedTool)return {type:'tool',name:'echo.read',arguments:{message:'forbidden'}};
    if(f.flags.scopedStream)return (function*(){yield 'PRIVATE_STREAM';})();
    return {type:'final',text:'Scoped answer 🧪'};
  }};
  const host={...f.host,
    applicationThreat:()=>settings.badApplicationThreat?{}:{policy:{id:'application-threat',version:'1'},state:{score:7,marker:'HOST_THREAT_ONLY'}},
    scopedPrompt:async(p,b)=>{
      promptBindings.push(structuredClone(b));
      if(f.flags.throwScopedPrompt)throw Error('PRIVATE_PROMPT_DETAIL');
      if(f.flags.workflowPrompt)return f.host.prompt(p,b);
      const attributes=scopedPromptContext(b);
      if(f.flags.wrongScopedBinding)attributes['scope-version']='99';
      const prompt=signEnvelope(f.flags.wrongScopedText?'Wrong scope.':system,{algorithm:'hmac-sha256',signatureVersion:'2.0',secretId:'test-signing-key',timestamp:900,expires:f.flags.expiredScoped?1000:1700,version:'1.0.0',sectionType:'system',contentType:'text',trustLevel:2,attributes},new Uint8Array(32).fill(19));
      if(f.flags.tamperedScoped)prompt.data='tampered';return prompt;
    },
    scopeBoundary:(p,b,d)=>{
      boundaries.push({binding:structuredClone(b),data:structuredClone(d)});
      if(f.flags.throwBoundary)throw Error('PRIVATE_BOUNDARY_DETAIL');
      if(f.flags.badBoundary)return {decision:true};
      if(f.flags.boundaryCancel)f.baseFlags.cancelled=true;
      if(f.flags.boundaryRevoke)f.baseFlags.revoked=true;
      if(f.flags.boundaryDrift)f.baseFlags.drift=true;
      if(f.flags.boundaryExpiry)f.baseFlags.now=1700;
      const denied=b.phase==='ingress'?f.flags.denyIngress:f.flags.denyEgress,digest=bindingDigest(b),state={...d.threatState,score:d.threatState.score+(denied?10:1)};
      if(f.flags.mutateBoundary){p.subjectId='forged';b.scope.id='forged';d.threatState.marker='forged';d.request.message='forged';}
      return {bindingDigest:f.flags.wrongBoundaryBinding?'wrong':digest,decision:f.flags.unknownBoundary?'unsupported':denied?'deny':'allow',threatState:state};
    },
    planScopedTurn:(p,b,d)=>{
      if(f.flags.throwScopedPlan)throw Error('PRIVATE_PLAN_DETAIL');
      if(f.flags.badScopedPlan)return {retained:{},state:{reopened:true}};
      const retained={...d.retained,scoped:true};
      if(f.flags.mutateScopedPlan){p.subjectId='forged';b.scope.id='forged';d.candidate.text='forged';}
      return {retained};
    },
    policy:async(p,b,d,phase)=>{
      const result=await f.host.policy(p,b,d,phase);
      if(b.postCompletion==='scoped'&&(f.flags.denyInference&&phase==='inference'||f.flags.denyRelease&&phase==='release'))result.resources[0].capabilities=['used-for-model-training'];
      return result;
    }
  };
  try {
    const loop=new ScopedLlmLoop(f.store,f.gate,host,provider,definition);
    await loop.run('test-owner',f.session.sessionId,{message:'Finish workflow.'},f.options);
    return {...f,loop,host,provider,definition,boundaries,promptBindings,options:{...f.options,requestId:'scope-1',expectedVersion:2},replaceScope:()=>new ScopedLlmLoop(f.store,f.gate,host,provider,{...definition,scope:{...definition.scope,version:'2'}})};
  }catch(e){f.close();throw e;}
}
export function records(f) {
  const db=new DatabaseSync(join(f.directory,'state.sqlite'));
  try{return db.prepare('SELECT body FROM psp_records ORDER BY kind,record_key').all().map(r=>JSON.parse(r.body));}finally{db.close();}
}
export async function runCase(c) {
  let f;const steps=[];
  try {
    f=await fixture(c.settings);Object.assign(f.flags,c.flags??{});if(f.flags.changedScope)f.loop=f.replaceScope();
    for(const step of c.steps??[{}]) {
      Object.assign(f.flags,step.flags??{});Object.assign(f.baseFlags,step.baseFlags??{});f.baseFlags.denyPersistence=!!f.flags.denyStorage;
      const options={...f.options,...step.options},token=step.token??'test-owner';
      try {const value=step.action==='recover'?await f.loop.recover(token,f.session.sessionId,step.requestId??'scope-1',options):await f.loop.run(token,f.session.sessionId,step.request??{message:'Explain the completed result.'},options);steps.push({code:'OK',value});}
      catch(e){steps.push({code:e.code??'UNEXPECTED_ERROR'});}
    }
    const all=records(f),state=all.find(r=>r.sessionId===f.session.sessionId&&r.status),meta=state.llmCompletion;
    const receipts=all.filter(r=>r.result?.scoped).map(r=>r.result).sort((a,b)=>a.requestId.localeCompare(b.requestId));
    return JSON.parse(JSON.stringify({steps,codes:steps.map(s=>s.code),version:state.version,...f.stats(),turnCount:meta.turnCount,violationCount:meta.violationCount,state,receipts,boundaries:f.boundaries,promptBindings:f.promptBindings,requests:f.requests,commands:f.commands}).replaceAll(f.session.sessionId,'<session>'));
  }catch(e){return {code:e.code??'UNEXPECTED_ERROR'};}finally{f?.close();}
}
