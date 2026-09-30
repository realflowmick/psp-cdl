// SPDX-License-Identifier: Apache-2.0
// A single synthetic scenario in an isolated process. No network without explicit admission.
import {readFileSync} from 'node:fs';
import {runCase,configuration} from './context-service-fixtures.mjs';
import {createOpenAIChatProvider,OPENAI_CHAT_MODEL,OPENAI_CONTEXT_PROFILE} from '@psp-cdl/llmproxy';
import {gradeCase} from './interpreter-validation.mjs';

const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8').replaceAll('\r\n','\n');
const suite=JSON.parse(read('conformance/vectors/llm/interpreter-validation-0.1.json'));
const request=JSON.parse(readFileSync(0,'utf8'));
if(request.action==='grade-many') {
  console.log(JSON.stringify(request.observations.map(o=>{
    const c=suite.cases.find(c=>c.id===o.caseId);
    if(!c)throw Error('UNKNOWN_CASE');
    return gradeCase(c,o);
  })));
} else if(request.action==='grade') {
  const c=suite.cases.find(c=>c.id===request.observation.caseId);
  if(!c)throw Error('UNKNOWN_CASE');
  console.log(JSON.stringify(gradeCase(c,request.observation)));
} else {
  const c=suite.cases.find(c=>c.id===request.caseId);
  if(!c||!['rehearsal','live'].includes(request.mode))throw Error('INVALID_REQUEST');
  let provider;
  const usage=[];
  if(request.mode==='live') {
    if(process.argv.slice(2).join(',')!=='--allow-live'||request.provider?.complete!==true||!request.provider.sources?.length)throw Error('LIVE_NOT_ADMITTED');
    provider=createOpenAIChatProvider({mode:'live',allowLive:true,apiKey:process.env.PSP_OPENAI_API_KEY??'',now:()=>1000,transcriptProfile:OPENAI_CONTEXT_PROFILE,
      complete:true,sources:request.provider.sources,limits:request.provider.limits,onUsage:v=>usage.push(v)});
  } else {
    if(process.argv.length!==2)throw Error('INVALID_REQUEST');
    const proposals=[...c.proposals,...(c.flags.resume?[{type:'answer',text:'Resumed from the persisted state.'}]:[])];
    let cursor=0;
    provider=createOpenAIChatProvider({mode:'offline',now:()=>1000,complete:true,transcriptProfile:OPENAI_CONTEXT_PROFILE,
      sources:[{id:'synthetic-rehearsal',capabilities:[]}],limits:request.provider?.limits??suite.providerLimits,onUsage:v=>usage.push(v),
      transport:()=>({status:200,contentType:'application/json',body:Buffer.from(JSON.stringify({
        id:'chatcmpl-synthetic',object:'chat.completion',created:1000,model:OPENAI_CHAT_MODEL,
        choices:[{index:0,finish_reason:'stop',message:{role:'assistant',content:JSON.stringify(proposals[Math.min(cursor++,proposals.length-1)])}}],
        usage:{prompt_tokens:30,completion_tokens:4,total_tokens:34}
      }),'utf8')})});
  }
  // Do not pass expectations or review rubrics to the fixture/provider.
  const runtime={initialState:c.initialState,message:c.message,flags:{...c.flags},proposals:request.mode==='rehearsal'?c.proposals:[]};
  const actual=await runCase(runtime,{capture:true,provider,configuration:{...configuration,application:read('examples/in-context/validation/application.psp')}});
  console.log(JSON.stringify({profile:suite.profile,caseId:c.id,mode:request.mode,language:'typescript',usage,actual}));
}
