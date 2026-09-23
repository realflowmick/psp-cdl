// SPDX-License-Identifier: Apache-2.0
// Public synthetic keys, callbacks and data only.
import {readFileSync} from 'node:fs';
import {fixture as durableFixture,normalize} from './durable-fixtures.mjs';
import {signEnvelope} from '@psp-cdl/core/crypto';
import {RefreshingLlmLoop,promptContext} from '@psp-cdl/llmproxy';
export const suite=JSON.parse(readFileSync(new URL('../conformance/vectors/llm/refresh-0.1.json',import.meta.url),'utf8'));
export async function fixture(settings={}) {
  const f=await durableFixture({continueTurn:true,...settings,base:{...settings.base,promptRefresh:!settings.disabledRefresh}}),refreshRequests=[],refreshEvents=[];
  let template={version:'1.0.0',text:'System one.',timestamp:900,expires:1200,attributes:{'refresh-policy':'interval|expiration','refresh-interval':'2','refresh-grace':'100'},...settings.initial};
  const sign=(b,t)=>signEnvelope(t.text,{algorithm:'hmac-sha256',signatureVersion:'2.0',secretId:'test-signing-key',timestamp:t.timestamp,expires:t.expires,version:t.version,sectionType:'system',contentType:'text',trustLevel:t.trustLevel??2,attributes:{...promptContext(b),...t.attributes}},new Uint8Array(32).fill(19));
  const host={...f.host,
    prompt:(_p,b)=>sign(b,{...template,...f.flags.bindingTemplate}),
    refresh:async(p,b,request)=>{
      refreshRequests.push(structuredClone(request));
      if(f.flags.onRefresh)await f.flags.onRefresh(p,b,request);
      if(f.flags.throwRefresh)throw Error('PRIVATE_REFRESH_DETAIL');
      if(f.flags.refreshCancel)f.baseFlags.cancelled=true;
      if(f.flags.refreshDrift)f.baseFlags.drift=true;
      if(f.flags.refreshRevoke)f.baseFlags.revoked=true;
      if(f.flags.refreshRace){try{await f.update();}catch(e){if(e.code!=='STATE_BUSY')throw e;refreshEvents.push({signal:'STATE_BUSY'});}}
      template={...template,version:f.flags.refreshVersion??'1.0.1',text:f.flags.refreshText??'System refreshed.',timestamp:f.flags.refreshTimestamp??f.baseFlags.now,expires:f.flags.refreshExpires??f.baseFlags.now+500,...f.flags.replacement};
      const e=sign(b,template);
      if(f.flags.tamperedRefresh)e.data='tampered';
      if(f.flags.wrongRefreshScope)e.signature.attributes['session-id']='other';
      return e;
    },
    authorizeRefresh:(_p,b,_previous,_candidate)=>!(b.trigger==='initial'?f.flags.denyInitial:f.flags.denyRefresh),
    auditRefresh:(_p,event)=>{refreshEvents.push(event);if(f.flags.throwRefreshAudit)throw Error('PRIVATE_AUDIT_DETAIL');return !f.flags.denyRefreshAudit;}
  };
  f.baseFlags.onInvoke=()=>{if(f.flags.afterToolTime)f.baseFlags.now=f.flags.afterToolTime;};
  const commit=f.backend.commit.bind(f.backend);
  f.backend.commit=async(...args)=>{
    const ok=await commit(...args);
    if(ok&&f.flags.failAfterPromptCommit&&args[2].some(w=>w.body.profile==='PSP-PROMPT-REFRESH-0.1'))throw Error('PRIVATE_ACK_DETAIL');
    return ok;
  };
  const invoke=f.provider.invoke;
  const provider={...f.provider,invoke:async(...args)=>{const result=await invoke(...args);if(f.flags.afterProviderTime)f.baseFlags.now=f.flags.afterProviderTime;return result;}};
  try{return {...f,host,provider,refreshRequests,refreshEvents,loop:new RefreshingLlmLoop(f.store,f.gate,host,provider,{postCompletion:'lockdown'})};}
  catch(e){f.close();throw e;}
}
export async function runCase(c){
  let f;const steps=[];
  try{
    f=await fixture(c.settings);
    for(const step of c.steps??[{action:'run'}]){
      Object.assign(f.flags,step.flags??{});Object.assign(f.baseFlags,step.baseFlags??{});
      const options={...f.options,...step.options};
      if(step.action==='restart')f.loop=new RefreshingLlmLoop(f.store,f.gate,f.host,f.provider,{postCompletion:'lockdown'});
      try{const value=step.action==='recover'?await f.loop.recover(step.token??'test-owner',f.session.sessionId,step.requestId??'turn-1',options):await f.loop.run(step.token??'test-owner',f.session.sessionId,step.request??{message:'Read synthetic data.'},options);steps.push({code:'OK',value});}
      catch(e){steps.push({code:e.code??'UNEXPECTED_ERROR'});}
    }
    const state=await f.store.execute(f.actor,{action:'getSession',sessionId:f.session.sessionId});
    let prompt=null;try{prompt=await f.store.execute(f.actor,{action:'getPromptState',sessionId:f.session.sessionId});}catch(e){if(e.code!=='NOT_FOUND')throw e;}
    return normalize({steps,codes:steps.map(s=>s.code),released:steps.filter(s=>s.code==='OK').length,...f.stats(),sessionVersion:state.version,status:state.status,prompt,turnCount:prompt?.state.turnCount??null,refreshCount:prompt?.state.refreshCount??null,version:prompt?.state.version??null,refreshCalls:f.refreshRequests.length,refreshRequests:f.refreshRequests,events:f.refreshEvents,requests:f.requests,commands:f.commands},f.session.sessionId);
  }catch(e){return {code:e.code??'UNEXPECTED_ERROR'};}finally{f?.close();}
}
