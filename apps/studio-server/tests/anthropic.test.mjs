// SPDX-License-Identifier: Apache-2.0
// The studio's Anthropic Messages adapter against a scripted fetch; no network, synthetic key.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createAnthropicProvider,describeAnthropicFailure,encodeAnthropicRequest,decodeAnthropicReply,ANTHROPIC_MESSAGES_URL,ANTHROPIC_VERSION} from '../dist/index.js';

const KEY='sk-ant-synthetic-adapter-0000';
const LIMITS={maxRequestBytes:65536,maxResponseBytes:65536,maxOutputTokens:512,maxCalls:4,budgetTokens:10000,timeoutMs:5000};
const TOOLS=[
  {name:'crm.notes',inputSchema:{type:'object',properties:{}},outputSchema:{type:'object'}},
  {name:'crm.lookup',inputSchema:{type:'object',properties:{id:{type:'string'}}},outputSchema:{type:'object'}}];
const request=(extra=[],tools=TOOLS)=>({messages:[{role:'system',content:'SYSTEM TEXT'},{role:'user',content:'hello'},...extra],tools});
const reply=(content,stop='end_turn',usage={input_tokens:10,output_tokens:5})=>({id:'msg_1',type:'message',role:'assistant',model:'claude-test-1',content,stop_reason:stop,usage});
const bytes=o=>new TextEncoder().encode(typeof o==='string'?o:JSON.stringify(o));
const options=(extra={})=>({deadline:Math.floor(Date.now()/1000)+60,cancelled:()=>false,...extra});

/** Answers each call with the next scripted response; an Error entry rejects like a network failure. */
function scripted(responses){
  const calls=[];
  const f=async(url,init)=>{
    calls.push({url,init,headers:init.headers,body:JSON.parse(new TextDecoder().decode(init.body))});
    const next=responses.shift();
    if(!next) throw new Error('unexpected call');
    if(next instanceof Error) throw next;
    const {status=200,body,headers={'content-type':'application/json'}}=next;
    return new Response(typeof body==='string'?body:JSON.stringify(body),{status,headers});
  };
  f.calls=calls;
  return f;
}
function provider(fetch,extra={}){
  const usage=[],failures=[];
  const p=createAnthropicProvider({apiKey:KEY,model:'claude-test-1',sources:[{id:'provider',capabilities:[]}],complete:true,now:()=>Math.floor(Date.now()/1000),limits:LIMITS,fetch,
    onUsage:u=>usage.push(u),onFailure:f=>failures.push(f),...extra});
  return {p,usage,failures};
}

test('encode maps the loop request onto the Messages API with host-side tool names',()=>{
  const {body,names}=encodeAnthropicRequest(request([
    {role:'assistant',call:{name:'crm.lookup',arguments:{id:'4471'}}},
    {role:'tool',name:'crm.lookup',data:{open:2}}]),'claude-test-1',LIMITS);
  assert.deepEqual(names,['crm.lookup','crm.notes'],'tools are sorted by name');
  const wire=JSON.parse(new TextDecoder().decode(body));
  assert.equal(wire.model,'claude-test-1');assert.equal(wire.system,'SYSTEM TEXT');
  assert.equal(wire.max_tokens,512);assert.equal(wire.stream,false);assert.deepEqual(wire.thinking,{type:'disabled'});
  assert.deepEqual(wire.tools.map(t=>[t.name,t.description]),[['psp_tool_0','crm.lookup'],['psp_tool_1','crm.notes']]);
  assert.deepEqual(wire.tool_choice,{type:'auto',disable_parallel_tool_use:true});
  assert.deepEqual(wire.messages,[
    {role:'user',content:[{type:'text',text:'hello'}]},
    {role:'assistant',content:[{type:'tool_use',id:'psp_call_0',name:'psp_tool_0',input:{id:'4471'}}]},
    {role:'user',content:[{type:'tool_result',tool_use_id:'psp_call_0',content:'{"open":2}'}]}]);
  const bare=JSON.parse(new TextDecoder().decode(encodeAnthropicRequest(request([],[]),'claude-test-1',LIMITS).body));
  assert.equal(bare.tools,undefined);assert.equal(bare.tool_choice,undefined);
});

test('encode refuses malformed requests and transcript text outside the context loop',()=>{
  const code=(input,transcript=false,limits=LIMITS)=>{try{encodeAnthropicRequest(input,'claude-test-1',limits,transcript);return 'ok';}catch(e){return e.code;}};
  assert.equal(code({messages:[{role:'user',content:'hi'}],tools:[]}),'INVALID_REQUEST');
  assert.equal(code({messages:[{role:'system',content:''},{role:'user',content:'hi'}],tools:[]}),'INVALID_REQUEST','an empty system prompt');
  assert.equal(code(request([{role:'assistant',call:{name:'crm.delete',arguments:{}}}])),'INVALID_REQUEST','a call to an unlisted tool');
  assert.equal(code(request([{role:'assistant',call:{name:'crm.lookup',arguments:{}}}])),'INVALID_REQUEST','a call without its result');
  assert.equal(code(request([],[{name:'bad name',inputSchema:{type:'object'},outputSchema:{}}])),'INVALID_REQUEST');
  const transcript=request([{role:'assistant',content:'earlier answer'},{role:'user',content:'and now?'}]);
  assert.equal(code(transcript),'INVALID_REQUEST');
  assert.equal(code(transcript,true),'ok');
  assert.equal(code(request(),false,{...LIMITS,maxRequestBytes:64}),'REQUEST_TOO_LARGE');
});

test('decode returns a final text or one mapped tool call and rejects everything else',()=>{
  const names=['crm.lookup','crm.notes'];
  const final=decodeAnthropicReply(bytes(reply([{type:'text',text:'Hello '},{type:'text',text:'there'}])),names,LIMITS);
  assert.deepEqual(final.result,{type:'final',text:'Hello there'});
  assert.deepEqual(final.usage,{inputTokens:10,outputTokens:5,cacheReadTokens:0,cacheWriteTokens:0,model:'claude-test-1'});
  const tool=decodeAnthropicReply(bytes(reply([{type:'thinking',thinking:'...',signature:'s'},{type:'text',text:'Checking.'},{type:'tool_use',id:'toolu_1',name:'psp_tool_1',input:{}}],'tool_use',{input_tokens:1,output_tokens:1,cache_read_input_tokens:7})),names,LIMITS);
  assert.deepEqual(tool.result,{type:'tool',name:'crm.notes',arguments:{}});assert.equal(tool.usage.cacheReadTokens,7);
  const code=(body,limits=LIMITS)=>{try{decodeAnthropicReply(bytes(body),names,limits);return 'ok';}catch(e){return e.code;}};
  const use=(name,id='toolu_1')=>({type:'tool_use',id,name,input:{}});
  assert.equal(code(reply([use('psp_tool_9')],'tool_use')),'INVALID_RESPONSE','an unknown wire tool name');
  assert.equal(code(reply([use('psp_tool_0'),use('psp_tool_1','toolu_2')],'tool_use')),'INVALID_RESPONSE','parallel calls');
  assert.equal(code(reply([{type:'image',source:{}}])),'INVALID_RESPONSE');
  assert.equal(code(reply([{type:'text',text:'x'}],'max_tokens')),'OUTPUT_TRUNCATED');
  assert.equal(code(reply([],'refusal')),'PROVIDER_REFUSED');
  assert.equal(code(reply([{type:'text',text:'x'}],'end_turn',{input_tokens:1,output_tokens:513})),'INVALID_RESPONSE','more output than requested');
  assert.equal(code('not json'),'INVALID_RESPONSE');
  assert.equal(code(reply([{type:'text',text:'x'}]),{...LIMITS,maxResponseBytes:16}),'RESPONSE_TOO_LARGE');
});

test('the provider posts to the fixed endpoint with the key in a header and reports usage',async()=>{
  const fetch=scripted([
    {body:reply([{type:'tool_use',id:'toolu_1',name:'psp_tool_0',input:{id:'4471'}}],'tool_use')},
    {body:reply([{type:'text',text:'Two items are open.'}],'end_turn',{input_tokens:20,output_tokens:6})}]);
  const {p,usage,failures}=provider(fetch);
  assert.equal(p.id,'anthropic-messages');assert.equal(p.revision,`messages-${ANTHROPIC_VERSION}-claude-test-1`);
  assert.deepEqual(Object.keys(p).sort(),['complete','id','invoke','revision','sources'],'exactly the keys the reference loop accepts');
  assert.equal(fetch.calls.length,0,'construction performs no I/O');
  assert.deepEqual(await p.invoke(request(),options()),{type:'tool',name:'crm.lookup',arguments:{id:'4471'}});
  const next=request([{role:'assistant',call:{name:'crm.lookup',arguments:{id:'4471'}}},{role:'tool',name:'crm.lookup',data:{open:2}}]);
  assert.deepEqual(await p.invoke(next,options()),{type:'final',text:'Two items are open.'});
  const [first]=fetch.calls;
  assert.equal(first.url,ANTHROPIC_MESSAGES_URL);assert.equal(first.init.method,'POST');assert.equal(first.init.redirect,'error');
  assert.equal(first.headers['x-api-key'],KEY);assert.equal(first.headers['anthropic-version'],ANTHROPIC_VERSION);assert.equal(first.headers['accept-encoding'],'identity');
  assert.doesNotMatch(JSON.stringify(first.body),new RegExp(KEY),'the key never travels in the body');
  assert.deepEqual(usage.map(u=>[u.attempt,u.inputTokens,u.outputTokens]),[[1,10,5],[2,20,6]]);
  assert.deepEqual(failures,[]);
});

test('HTTP and transport failures keep the status and provider message but never the key',async()=>{
  const cases=[
    [{status:401,body:{type:'error',error:{type:'authentication_error',message:'invalid x-api-key'}}},'KEY_REJECTED',/HTTP 401: authentication_error: invalid x-api-key\. Check anthropic\.apiKey/],
    [{status:404,body:{type:'error',error:{type:'not_found_error',message:'model: claude-test-1'}}},'MODEL_NOT_FOUND',/Check the model id/],
    [{status:429,body:'{}'},'PROVIDER_RATE_LIMITED',/HTTP 429\.$/],
    [{status:529,body:'overloaded'},'PROVIDER_OVERLOADED',/HTTP 529/],
    [{status:500,body:''},'PROVIDER_HTTP_ERROR',/HTTP 500/],
    [new TypeError('fetch failed'),'PROVIDER_UNREACHABLE',/could not be reached/],
    [{body:'<html>',headers:{'content-type':'text/html'}},'INVALID_RESPONSE',/\(INVALID_RESPONSE\)/],
    [{body:reply([{type:'text',text:'x'}]),headers:{'content-type':'application/json','content-encoding':'gzip'}},'INVALID_RESPONSE',/INVALID_RESPONSE/]];
  for(const [response,code,described] of cases){
    const {p,failures}=provider(scripted([response]));
    await assert.rejects(p.invoke(request(),options()),{name:'AnthropicError',code},code);
    assert.equal(failures.length,1);assert.equal(failures[0].code,code);
    assert.match(describeAnthropicFailure(failures[0]),described);
    assert.doesNotMatch(JSON.stringify(failures),new RegExp(KEY));
  }
});

test('call and token budgets, cancellation and deadlines stop calls before they are sent',async()=>{
  let fetch=scripted([{body:reply([{type:'text',text:'a'}])},{body:reply([{type:'text',text:'b'}])}]);
  let {p,failures}=provider(fetch,{limits:{...LIMITS,maxCalls:2}});
  await p.invoke(request(),options());await p.invoke(request(),options());
  await assert.rejects(p.invoke(request(),options()),{code:'BUDGET_EXHAUSTED'});
  assert.equal(fetch.calls.length,2);assert.match(describeAnthropicFailure(failures[0]),/2 model calls/);

  fetch=scripted([{body:reply([{type:'text',text:'a'}],'end_turn',{input_tokens:15,output_tokens:10})}]);
  ({p}=provider(fetch,{limits:{...LIMITS,budgetTokens:20}}));
  await p.invoke(request(),options());
  await assert.rejects(p.invoke(request(),options()),{code:'BUDGET_EXHAUSTED'});
  assert.equal(fetch.calls.length,1);

  fetch=scripted([]);({p}=provider(fetch));
  await assert.rejects(p.invoke(request(),options({cancelled:()=>true})),{code:'CANCELLED'});
  await assert.rejects(p.invoke(request(),options({deadline:Math.floor(Date.now()/1000)-1})),{code:'DEADLINE_EXCEEDED'});
  await assert.rejects(p.invoke(request(),{deadline:1}),{code:'INVALID_REQUEST'});
  assert.equal(fetch.calls.length,0);
});

test('configuration is validated up front and the context loop gets its own provider id',()=>{
  const make=extra=>()=>createAnthropicProvider({apiKey:KEY,model:'claude-test-1',sources:[{id:'provider',capabilities:[]}],complete:true,now:()=>0,limits:LIMITS,...extra});
  for(const extra of [{model:'bad model'},{model:''},{apiKey:''},{complete:false},{limits:{...LIMITS,maxCalls:0}},{limits:{...LIMITS,maxCalls:257}},{limits:{...LIMITS,timeoutMs:300_001}},{limits:{...LIMITS,extra:1}}])
    assert.throws(make(extra),{code:'INVALID_CONFIGURATION'},JSON.stringify(extra));
  assert.equal(make({transcript:true})().id,'anthropic-messages-context');
});
