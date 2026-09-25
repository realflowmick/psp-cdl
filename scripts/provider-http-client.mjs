// SPDX-License-Identifier: Apache-2.0
// Test-only interception of the fixed HTTPS endpoint; production has no URL override.
import assert from 'node:assert/strict';
import https from 'node:https';
import {syncBuiltinESMExports} from 'node:module';
import {readFileSync} from 'node:fs';
const config=JSON.parse(process.argv[2]);
const original=https.request;
let cancelled=false,timer;
https.request=(url,options,callback)=>{
  assert.equal(url,'https://api.openai.com/v1/chat/completions');
  assert.equal(options.rejectUnauthorized,true);
  assert.equal(options.headers.Authorization,'Bearer SYNTHETIC_HTTP_KEY');
  assert.equal(options.agent,false);
  const req=original(config.endpoint,{...options,...(config.untrusted?{}:{ca:readFileSync(config.cert)})},callback);
  if(config.mode==='cancel'||config.mode==='cancel-body')req.on('finish',()=>{timer=setTimeout(()=>{cancelled=true;},50);});
  return req;
};
syncBuiltinESMExports();
const {createOpenAIChatProvider}=await import('@psp-cdl/llmproxy');
const {suite}=await import('./provider-fixtures.mjs');
const provider=createOpenAIChatProvider({mode:'live',allowLive:true,apiKey:'SYNTHETIC_HTTP_KEY',complete:true,sources:[],now:()=>1000,
  limits:{...suite.limits,timeoutMs:config.mode==='hang'?500:3000}});
try{
  const result=await provider.invoke(suite.request,{deadline:1800,cancelled:()=>cancelled});
  console.log(JSON.stringify({code:'OK',released:1,result}));
}catch(e){console.log(JSON.stringify({code:e.code??'UNEXPECTED_ERROR',released:0}));}
finally{clearTimeout(timer);}
