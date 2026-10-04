// SPDX-License-Identifier: Apache-2.0
import https from 'node:https';
import {createHash} from 'node:crypto';
import {canonicalJson,parseJson} from '@psp-cdl/core';
import {aggregateCapabilities,evaluatePolicy} from '@psp-cdl/cdl';
export const MODELS={anthropic:'claude-opus-4-8',openai:'gpt-4.1-mini-2025-04-14'},INPUT_RESERVATION=1048576;
export class CampaignError extends Error{constructor(code){super(code);this.code=code;}}
export function requireThat(ok,code){if(!ok)throw new CampaignError(code);}
const obj=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
export function ready(config){
  requireThat(config.model===MODELS[config.provider],'UNSUPPORTED_MODEL');
  requireThat(config.complete===true&&config.sources.length>0,'PROVIDER_NOT_REVIEWED');
  const capabilities=aggregateCapabilities(config.sources,true);
  requireThat(evaluatePolicy({classes:[],covenants:['no-training'],capabilities,checks:{},parameters:{},context:{}}).decision==='allow','PROVIDER_POLICY_DENIED');
}
export function encode(config,limits,system,messages){
  requireThat(config.model===MODELS[config.provider],'UNSUPPORTED_MODEL');
  requireThat(typeof system==='string'&&system.length&&Array.isArray(messages)&&messages.length>=1&&messages.length<=512,'INVALID_REQUEST');
  requireThat(messages.every(m=>obj(m)&&Object.keys(m).sort().join(',')==='content,role'&&['user','assistant'].includes(m.role)&&typeof m.content==='string')&&messages[0].role==='user'&&messages.at(-1).role==='user','INVALID_REQUEST');
  const request=config.provider==='anthropic'?{model:config.model,system,messages,stream:false,max_tokens:limits.maxOutputTokens,thinking:{type:'disabled'}}:
    {model:config.model,messages:[{role:'system',content:system},...messages],stream:false,store:false,n:1,max_completion_tokens:limits.maxOutputTokens};
  const body=Buffer.from(canonicalJson(request),'utf8');requireThat(body.length<=limits.maxRequestBytes,'CONTEXT_LIMIT');return body;
}
export function decode(config,limits,reply){
  requireThat(obj(reply)&&Object.keys(reply).sort().join(',')==='body,contentType,status','INVALID_RESPONSE');
  requireThat(reply.status===200,'PROVIDER_HTTP_ERROR');requireThat(Buffer.isBuffer(reply.body)&&reply.body.length<=limits.maxResponseBytes,'RESPONSE_TOO_LARGE');
  requireThat(typeof reply.contentType==='string'&&/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(reply.contentType),'INVALID_RESPONSE');
  let v;try{v=parseJson(new TextDecoder('utf-8',{fatal:true}).decode(reply.body));}catch{throw new CampaignError('INVALID_RESPONSE');}
  requireThat(obj(v)&&v.model===config.model,'MODEL_MISMATCH');let text,tokens;
  if(config.provider==='anthropic'){
    requireThat(v.type==='message'&&v.role==='assistant'&&v.stop_reason==='end_turn','INCOMPLETE_RESPONSE');
    requireThat(Array.isArray(v.content)&&v.content.length>0&&v.content.every(b=>obj(b)&&b.type==='text'&&typeof b.text==='string'),'UNSUPPORTED_RESPONSE');
    text=v.content.map(b=>b.text).join('');const u=v.usage??{};tokens=[u.input_tokens,u.output_tokens,u.cache_creation_input_tokens??0,u.cache_read_input_tokens??0];
  }else{
    requireThat(Array.isArray(v.choices)&&v.choices.length===1&&v.choices[0].finish_reason==='stop','INCOMPLETE_RESPONSE');const m=v.choices[0].message??{};
    requireThat(m.role==='assistant'&&typeof m.content==='string'&&!m.tool_calls&&!m.refusal,'UNSUPPORTED_RESPONSE');text=m.content;const u=v.usage??{};tokens=[u.prompt_tokens,u.completion_tokens,0,0];
  }
  requireThat(tokens.every(n=>Number.isSafeInteger(n)&&n>=0&&n<=INPUT_RESERVATION),'INVALID_USAGE');
  requireThat(tokens[1]<=limits.maxOutputTokens&&tokens[0]+tokens[2]+tokens[3]<=INPUT_RESERVATION,'INVALID_USAGE');
  return {text,model:v.model,usage:{inputTokens:tokens[0]+tokens[2]+tokens[3],outputTokens:tokens[1],cacheWriteTokens:tokens[2],cacheReadTokens:tokens[3]}};
}
export function httpsTransport(provider,key,body,limits,cancelled){return new Promise((resolve,reject)=>{
  const url=provider==='anthropic'?'https://api.anthropic.com/v1/messages':'https://api.openai.com/v1/chat/completions';
  const headers={'Content-Type':'application/json',Accept:'application/json','Accept-Encoding':'identity','Content-Length':body.length,
    ...(provider==='anthropic'?{'x-api-key':key,'anthropic-version':'2023-06-01'}:{Authorization:'Bearer '+key})};
  let done=false,req,timer,poll;const finish=(error,value)=>{if(done)return;done=true;clearTimeout(timer);clearInterval(poll);if(error){req?.destroy();reject(error);}else resolve(value);};
  if(cancelled()){finish(new CampaignError('CANCELLED'));return;}
  req=https.request(url,{method:'POST',headers,rejectUnauthorized:true,agent:false},res=>{
    if(res.statusCode!==200){res.destroy();finish(new CampaignError('PROVIDER_HTTP_ERROR'));return;}
    if((res.headers['content-encoding']??'identity')!=='identity'){res.destroy();finish(new CampaignError('INVALID_RESPONSE'));return;}
    let size=0;const chunks=[];
    res.on('data',chunk=>{size+=chunk.length;if(size>limits.maxResponseBytes){res.destroy();finish(new CampaignError('RESPONSE_TOO_LARGE'));}else chunks.push(chunk);});
    res.on('error',()=>finish(new CampaignError('PROVIDER_FAILED')));
    res.on('end',()=>finish(null,{status:res.statusCode,contentType:res.headers['content-type']??'',body:Buffer.concat(chunks)}));
  });
  req.on('error',()=>finish(new CampaignError('PROVIDER_FAILED')));
  timer=setTimeout(()=>finish(new CampaignError('DEADLINE_EXCEEDED')),limits.timeoutMs);
  poll=setInterval(()=>{if(cancelled())finish(new CampaignError('CANCELLED'));},20);
  req.end(body);
});}
export class TextProvider{
  constructor(config,limits,maxCalls,{live=false,allowLive=false,transport=null,cancelled=()=>false}={}){
    requireThat(config.model===MODELS[config.provider],'UNSUPPORTED_MODEL');requireThat(!live||(allowLive&&transport===null),'LIVE_NOT_ADMITTED');
    requireThat(live||transport!==null,'OFFLINE_TRANSPORT_REQUIRED');if(live)ready(config);
    Object.assign(this,{config,limits,maxCalls,live,transport,cancelled,calls:0});
  }
  async invoke(system,messages){
    requireThat(!this.cancelled(),'CANCELLED');const body=encode(this.config,this.limits,system,messages);requireThat(this.calls<this.maxCalls,'CALL_LIMIT');
    let key='';if(this.live){key=process.env[this.config.provider==='anthropic'?'ANTHROPIC_API_KEY':'PSP_OPENAI_API_KEY']??'';requireThat(key.length>0&&!/[\r\n]/.test(key),'CREDENTIAL_MISSING');}
    this.calls++;const start=performance.now();const reply=this.live?await httpsTransport(this.config.provider,key,body,this.limits,this.cancelled):await this.transport(body);
    requireThat(!this.cancelled(),'CANCELLED');const result=decode(this.config,this.limits,reply);
    return {...result,requestDigest:createHash('sha256').update(body).digest('hex'),elapsedMs:Math.round(performance.now()-start),usageBasis:this.live?'provider-reported':'synthetic-offline'};
  }
}
