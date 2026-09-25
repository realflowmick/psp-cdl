// SPDX-License-Identifier: Apache-2.0
// Separately invoked synthetic adapter smoke. Never run by examples, imports or CI.
import {createOpenAIChatProvider,OPENAI_CHAT_MODEL} from '@psp-cdl/llmproxy';
const args=process.argv.slice(2),budgetArg=args.find(a=>a.startsWith('--budget-tokens='));
if(args.length!==2||!args.includes('--allow-live')||!budgetArg||!/^--budget-tokens=[1-9][0-9]*$/.test(budgetArg)){
  console.log(JSON.stringify({status:'not_run',reason:'Require --allow-live and --budget-tokens=<ceiling>; supply PSP_OPENAI_API_KEY separately.'}));
  process.exitCode=2;
}else{
  let cancelled=false;const stop=()=>{cancelled=true;};process.on('SIGINT',stop);
  try{
    const provider=createOpenAIChatProvider({mode:'live',allowLive:true,apiKey:process.env.PSP_OPENAI_API_KEY??'',now:()=>Math.floor(Date.now()/1000),
      complete:true,sources:[{id:'synthetic-smoke',capabilities:['is-ai-system','cloud-processing']}],
      limits:{maxRequestBytes:4096,maxResponseBytes:8192,maxOutputTokens:32,maxCalls:1,budgetTokens:Number(budgetArg.split('=')[1]),timeoutMs:15000}});
    const result=await provider.invoke({messages:[{role:'system',content:'This is a synthetic adapter smoke test.'},{role:'user',content:'Return exactly SYNTHETIC_OK.'}],tools:[]},
      {deadline:Math.floor(Date.now()/1000)+15,cancelled:()=>cancelled});
    if(result.type!=='final'||result.text.trim()!=='SYNTHETIC_OK')throw {code:'SMOKE_OUTPUT_MISMATCH'};
    console.log(JSON.stringify({status:'passed',scope:'synthetic-adapter-only',model:OPENAI_CHAT_MODEL,streaming:false}));
  }catch(e){console.log(JSON.stringify({status:'failed',code:e.code??'PROVIDER_FAILED'}));process.exitCode=1;}
  finally{process.removeListener('SIGINT',stop);}
}
