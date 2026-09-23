// SPDX-License-Identifier: Apache-2.0
// Public synthetic key and credentials. Never use them for real data.
import {readFileSync} from 'node:fs';
import {fixture as dispatchFixture} from './dispatch-fixtures.mjs';
import {signEnvelope} from '@psp-cdl/core/crypto';
import {BufferedLlmLoop,promptContext} from '@psp-cdl/llmproxy';
import {bindingDigest} from '@psp-cdl/mcpproxy';
import {WorkflowStore} from '@psp-cdl/api-server/persistence';
export const suite=JSON.parse(readFileSync(new URL('../conformance/vectors/llm/loop-0.1.json',import.meta.url),'utf8'));
export async function fixture(settings={}) {
  const f=await dispatchFixture(settings.base??{}),flags={...settings},requests=[],phases=[];
  const authenticate=f.host.authenticate;
  f.host.authenticate=t=>{const p=authenticate(t);return p?{...p,scopes:[...p.scopes,...(flags.noModelScope?[]:['models:invoke'])]}:null;};
  let busy=0,keyRevoked=false;
  const key=new Uint8Array(32).fill(19);
  const host={
    authenticate:t=>f.host.authenticate(t),now:f.host.now,
    snapshot:()=>({...f.host.snapshot(),providerId:'mock',providerRevision:flags.wrongProvider?'model-2':'model-1',releaseSources:[{id:'display',capabilities:['can-display-to-operator']}]}),
    prompt:(_p,b)=>{
      const attributes=promptContext(b);
      if(flags.wrongPromptScope)attributes['session-id']='other';
      if(flags.refreshAttribute)attributes['refresh-policy']='interval';
      const e=signEnvelope('Use the synthetic read tool when needed.',{algorithm:'hmac-sha256',signatureVersion:'2.0',secretId:'test-signing-key',timestamp:900,expires:flags.expiredPrompt?1000:1700,version:'1.0.0',sectionType:'system',contentType:'text',trustLevel:flags.promptTrust??2,attributes},key);
      if(flags.tamperedPrompt)e.data='forged system text';
      return e;
    },
    verification:()=>({keys:[{id:'test-signing-key',algorithm:'hmac-sha256',material:key,status:flags.revokedPrompt||keyRevoked?'revoked':'active',trustLevels:[1,2,5],sectionTypes:['system'],scope:{},allowUnscoped:false}]}),
    policy:async(p,b,data,phase)=>{
      phases.push(phase);
      if(flags.throwPolicy)throw new Error('PRIVATE_POLICY_DETAIL');
      if(flags.driftPhase===phase)f.flags.drift=true;
      if(flags.cancelPhase===phase)f.flags.cancelled=true;
      if(flags.timeoutPhase===phase)f.flags.now=1800;
      if(flags.racePhase===phase){try{await f.update();}catch(e){if(e.code!=='STATE_BUSY')throw e;busy++;}}
      const resource={classes:[],covenants:flags.unsupportedPolicy?['unknown-term']:['no-training'],capabilities:flags.denyPhase===phase||flags.denyNextInference&&phase==='inference'&&requests.length>0?['used-for-model-training']:[],checks:{},parameters:{},context:{}};
      if(flags.displayDenied&&phase==='release')resource.covenants=['no-display-to-operator'];
      const digest=bindingDigest(b);
      if(flags.mutateHost){p.subjectId='other';b.sessionId='other';data.request.messages[0].content='forged';}
      return {bindingDigest:flags.wrongBinding?'wrong':digest,resources:flags.emptyPolicy?[]:[resource]};
    },
    authorizeFinal:()=>{if(flags.driftFinal)f.flags.drift=true;return flags.finalDenied?false:flags.nonBooleanFinal?'yes':true;}
  };
  const responses=settings.responses??[{type:'tool',name:'echo.read',arguments:{message:'hello 🧪'}},{type:'final',text:'Finished 🧪'}];
  const provider={id:'mock',revision:'model-1',complete:!flags.incompleteProvider,sources:[{id:'provider',capabilities:flags.providerTraining?['used-for-model-training']:[]}],
    invoke:async(request,options)=>{
      requests.push(structuredClone(request));
      if(flags.onProvider)await flags.onProvider(request,options);
      if(flags.throwProvider)throw new Error('PRIVATE_PROVIDER_DETAIL');
      if(flags.providerCancel)f.flags.cancelled=true;
      if(flags.providerTimeout)f.flags.now=1800;
      if(flags.providerExpiry)f.flags.now=1700;
      if(flags.providerDrift)f.flags.drift=true;
      if(flags.providerRevoke)f.flags.revoked=true;
      if(flags.providerKeyRevoke)keyRevoked=true;
      if(flags.bypassWrite){const store=new WorkflowStore(f.backend,{resumeSecret:new Uint8Array(32).fill(7),authorizePersistence:()=>true});await store.execute(f.actor,{action:'updateSession',requestId:'bypass',sessionId:f.session.sessionId,expectedVersion:1,nodeId:'entry',nodeVersion:'1',policyVersion:'policy-1',status:'running',state:{changed:true}});}
      if(flags.mutateProvider)request.messages[0].content='forged';
      if(flags.hugeResponse)return {type:'final',text:'x'.repeat(1_048_577)};
      if(flags.stream)return (function*(){yield 'PRIVATE_CHUNK';})();
      return structuredClone(responses[Math.min(requests.length-1,responses.length-1)]);
    }};
  try {
    const loop=new BufferedLlmLoop(f.store,f.gate,host,provider);
    return {...f,loop,loopHost:host,flags,baseFlags:f.flags,requests,phases,options:{...f.options,maxSteps:settings.maxSteps??4},stats:()=>({providerCalls:requests.length,toolCalls:f.stats().calls,busy})};
  }catch(e){f.close();throw e;}
}
export async function runCase(c) {
  let f;
  try {
    f=await fixture(c.settings);
    const input=c.settings?.inputSize?{message:'x'.repeat(c.settings.inputSize)}:c.request??{message:'Read synthetic data.'};
    const result=await f.loop.run(c.settings?.token??'test-owner',f.session.sessionId,input,f.options);
    return {code:'OK',...f.stats(),released:1,result,requests:f.requests,phases:f.phases};
  }catch(e){return {code:e.code??'UNEXPECTED_ERROR',...(f?.stats()??{providerCalls:0,toolCalls:0,busy:0}),released:0,requests:f?.requests??[],phases:f?.phases??[]};}
  finally{f?.close();}
}
