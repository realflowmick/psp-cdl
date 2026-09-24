// SPDX-License-Identifier: Apache-2.0
import {readFileSync} from 'node:fs';
import {canonicalJson} from '@psp-cdl/core';
import {BufferedLlmLoop,createOpenAIChatProvider,OPENAI_CHAT_REVISION} from '@psp-cdl/llmproxy';
import {fixture as loopFixture} from './llm-fixtures.mjs';
export const suite=JSON.parse(readFileSync(new URL('../conformance/vectors/llm/openai-chat-0.1.json',import.meta.url),'utf8'));

export async function runCase(c) {
  const s=c.settings,requests=[],outputs=[],codes=[];
  let f,clock=1000,cancelled=!!s.preCancel,provider;
  const base=()=>f?.baseFlags;
  const effect=()=>{
    if(s.effect==='cancel'){cancelled=true;if(f)base().cancelled=true;}
    if(s.effect==='deadline'){clock=1800;if(f)base().now=1800;}
    if(s.effect==='expiry'&&f)base().now=1700;
    if(s.effect==='drift'&&f)base().drift=true;
  };
  try {
    if(c.scope==='loop')f=await loopFixture(s.loop??{});
    const transport=(body,_signal)=>{
      const request=JSON.parse(Buffer.from(body).toString('utf8'));requests.push(request);
      if(f)f.requests.push(request);
      effect();
      if(s.throwTransport)throw new Error('PRIVATE_BACKEND_EXCEPTION SYNTHETIC_KEY');
      const responses=s.responses??(f?[suite.tool,suite.final]:[suite.final]);
      const raw=s.rawBody??canonicalJson(responses[Math.min(requests.length-1,responses.length-1)]);
      return {status:s.status??200,contentType:s.contentType??'application/json',body:s.invalidUtf8?new Uint8Array([255]):Buffer.from(raw,'utf8')};
    };
    const config={mode:'offline',now:()=>f?f.loopHost.now():clock,complete:true,
      sources:[{id:'provider',capabilities:s.loop?.providerTraining?['used-for-model-training']:[]}],
      limits:{...suite.limits,...s.limits},transport,...s.config};
    if(config.mode==='live')delete config.transport;
    provider=createOpenAIChatProvider(config);
    if(f) {
      const snapshot=f.loopHost.snapshot;
      f.loopHost.snapshot=(...args)=>({...snapshot(...args),providerId:provider.id,providerRevision:s.loop?.wrongProvider?'wrong':OPENAI_CHAT_REVISION});
      const loop=new BufferedLlmLoop(f.store,f.gate,f.loopHost,provider);
      const result=await loop.run(s.loop?.token??'test-owner',f.session.sessionId,{message:'Read synthetic data.'},f.options);
      outputs.push(result);codes.push('OK');
    } else {
      for(let attempt=0;attempt<(s.attempts??1);attempt++) {
        try {outputs.push(await provider.invoke(structuredClone(s.request??suite.request),{deadline:s.deadline??1800,cancelled:()=>cancelled}));codes.push('OK');}
        catch(e){codes.push(e.code??'UNEXPECTED_ERROR');}
      }
    }
  }catch(e){codes.push(e.code??'UNEXPECTED_ERROR');}
  finally{f?.close();}
  return {code:codes.at(-1),codes,transportCalls:requests.length,toolCalls:f?.stats().toolCalls??0,released:outputs.length,requests,outputs};
}
