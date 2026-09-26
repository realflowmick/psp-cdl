// SPDX-License-Identifier: Apache-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import {directLoop,offlineReply} from '../study-adapter.mjs';
import {caseInput,corpus} from '../study-common.mjs';
import {validate} from '../validate-study.mjs';
import {OPENAI_CHAT_MODEL,OPENAI_CHAT_REVISION,OPENAI_CHAT_INPUT_RESERVATION} from '@psp-cdl/llmproxy';
test('study plan model mapping and reservation agree with the adapter',()=>{
  assert.equal(OPENAI_CHAT_MODEL,'gpt-4.1-mini-2025-04-14');
  assert.equal(OPENAI_CHAT_REVISION,'chat-v1-gpt-4.1-mini-2025-04-14-psp-0.1');
  assert.equal(OPENAI_CHAT_INPUT_RESERVATION,1047576);
});
test('shared corpus and schema reject a missing condition and authority fields',()=>{
  validate('corpus',corpus);
  const bad=structuredClone(corpus);delete bad.cases[0].offlineExpected.combined;
  assert.throws(()=>validate('corpus',bad));
  assert.throws(()=>validate('capabilities',{complete:true,sources:[],apiKey:'never-accepted'}));
});
test('offline mapping uses actual provider tool aliases, including filtered catalogues',()=>{
  const c=caseInput('attack-direct-private');
  assert.equal(offlineReply(c,0,{tools:[]}).choices[0].message.content,'UNAVAILABLE');
  const reply=offlineReply(c,0,{tools:[{function:{description:'study.private',name:'psp_tool_9'}}]});
  assert.equal(reply.choices[0].message.tool_calls[0].function.name,'psp_tool_9');
});
test('direct loop checks cancellation before inference and bounds tool effects',async()=>{
  const calls=[],provider={sources:[],invoke:()=>({type:'tool',name:'study.public',arguments:{}})};
  const tools=[{name:'public',sources:[],inputSchema:{},outputSchema:{},invoke:()=>{calls.push(1);return {message:'public'};}}];
  const options={deadline:10,cancelled:()=>true,maxSteps:2};
  await assert.rejects(directLoop(provider,tools,caseInput('benign-public'),options,false,()=>0),{code:'CANCELLED'});
  assert.deepEqual(calls,[]);
  await assert.rejects(directLoop(provider,tools,caseInput('benign-public'),{...options,cancelled:()=>false},false,()=>0),{code:'STEP_LIMIT'});
  assert.deepEqual(calls,[1]);
});
test('CDL display gate rejects final output after an observed private read',async()=>{
  let step=0,reads=0;
  const provider={sources:[],invoke:()=>step++?{type:'final',text:'synthetic'}:{type:'tool',name:'study.private',arguments:{}}};
  const tools=[{name:'private',sources:[],inputSchema:{},outputSchema:{},invoke:()=>{reads++;return {message:'synthetic'};}}];
  await assert.rejects(directLoop(provider,tools,caseInput('attack-display-private'),{deadline:10,cancelled:()=>false,maxSteps:4},true,()=>0),{code:'OUTPUT_DENIED'});
  assert.equal(reads,1);
});
