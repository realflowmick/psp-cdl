// SPDX-License-Identifier: Apache-2.0
import {test,mock} from 'node:test';
import https from 'node:https';
import {EventEmitter} from 'node:events';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {TextProvider,decode,encode,ready,httpsTransport} from '../campaign-provider.mjs';
import {CampaignHost,initialState} from '../campaign-host.mjs';
import {validateCampaign} from '../validate-campaign.mjs';
const c=JSON.parse(readFileSync(new URL('../../evaluation/campaign-config.example.json',import.meta.url)));
const corpus=JSON.parse(readFileSync(new URL('../../conformance/vectors/evaluation/campaign-corpus-0.1.json',import.meta.url)));
test('HTTPS mapping is fixed, authenticated, cancellable and rejects redirects',async()=>{
  let seen,status=200;
  const mocked=mock.method(https,'request',(url,options,callback)=>{
    const request=new EventEmitter();request.destroy=()=>{};
    request.end=body=>{seen={url,options,body};queueMicrotask(()=>{
      const response=new EventEmitter();response.statusCode=status;response.headers={'content-type':'application/json'};response.destroy=()=>{};
      callback(response);if(status===200){response.emit('data',Buffer.from('{}'));response.emit('end');}
    });};return request;
  });
  try{
    assert.equal((await httpsTransport('anthropic','synthetic-secret',Buffer.from('{}'),c.limits,()=>false)).body.toString(),'{}');
    assert.equal(seen.url,'https://api.anthropic.com/v1/messages');assert.equal(seen.options.headers['x-api-key'],'synthetic-secret');
    assert.equal(seen.options.headers['anthropic-version'],'2023-06-01');assert.equal(seen.options.rejectUnauthorized,true);
    status=302;await assert.rejects(httpsTransport('anthropic','key',Buffer.from('{}'),c.limits,()=>false),/PROVIDER_HTTP_ERROR/);
    const count=mocked.mock.callCount();await assert.rejects(httpsTransport('anthropic','key',Buffer.from('{}'),c.limits,()=>true),/CANCELLED/);
    assert.equal(mocked.mock.callCount(),count);
  }finally{mocked.mock.restore();}
});
test('shared positive and negative provider response vectors',()=>{
  const suite=JSON.parse(readFileSync(new URL('../../conformance/vectors/evaluation/campaign-provider-0.1.json',import.meta.url)));
  for(const v of suite.cases){
    const p={...c.roles.attacker,provider:v.provider,model:v.model},reply={status:v.status,contentType:v.contentType,body:Buffer.from(v.body)};
    if(v.code==='OK')assert.equal(decode(p,c.limits,reply).usage.inputTokens,30,v.id);
    else assert.throws(()=>decode(p,c.limits,reply),new RegExp(v.code),v.id);
  }
});
test('shared config, corpus and referee contracts reject unsupported values',()=>{
  validateCampaign('config',c);validateCampaign('corpus',corpus);
  assert.throws(()=>validateCampaign('judge',{semanticAttack:'success'}));
  assert.throws(()=>validateCampaign('config',{...c,syntheticDataOnly:false}));
});
test('provider cannot silently go live, substitute a model or truncate context',()=>{
  const p=c.roles.attacker,l=c.limits;
  assert.throws(()=>new TextProvider(p,l,1),/OFFLINE_TRANSPORT_REQUIRED/);
  assert.throws(()=>new TextProvider(p,l,1,{live:true}),/LIVE_NOT_ADMITTED/);
  assert.throws(()=>ready(p),/PROVIDER_NOT_REVIEWED/);
  assert.throws(()=>ready({...p,complete:true,sources:[{id:'training',capabilities:['used-for-model-training']}]}),/PROVIDER_POLICY_DENIED/);
  assert.throws(()=>encode(p,l,'system',[{role:'user',content:'x'.repeat(l.maxRequestBytes)}]),/CONTEXT_LIMIT/);
  const v={model:p.model,type:'message',role:'assistant',stop_reason:'end_turn',content:[{type:'text',text:'{}'}],usage:{input_tokens:20,output_tokens:10}};
  const reply=v=>({status:200,contentType:'application/json',body:Buffer.from(JSON.stringify(v))});
  assert.equal(decode(p,l,reply(v)).usage.inputTokens,20);
  assert.throws(()=>decode(p,l,reply({...v,model:'other'})),/MODEL_MISMATCH/);
  assert.throws(()=>decode(p,l,reply({...v,stop_reason:'max_tokens'})),/INCOMPLETE_RESPONSE/);
  assert.throws(()=>decode(p,l,reply({...v,content:[{type:'thinking',thinking:'hidden'}]})),/UNSUPPORTED_RESPONSE/);
});
test('real dispatch, durable state and display controls record actual effects',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'campaign-'));
  try{
    for(const gated of [true,false]){
      const events=[],h=await CampaignHost.create(corpus.cases.find(c=>c.id==='state-attack'),gated,'SYNTHETIC-SECRET',join(dir,String(gated)+'.sqlite'),[{id:'synthetic',capabilities:[]}],e=>events.push(e),Math.floor(Date.now()/1000)+900);
      try{
        h.verifySystem('Authenticated application text.');
        assert.equal(h.release('SYNTHETIC-SECRET'),gated?null:'SYNTHETIC-SECRET');
        assert.equal((await h.execute({type:'read',name:'private'},()=>false)).status,gated?'denied':'committed');
        const state=initialState();state.variables.status='GREEN';
        await h.execute({type:'save',node:'help',state:{...state,current_node:'help'}},()=>false);
        assert.equal((await h.view()).node,'help'); // Host accepts model-selected route; no condition evaluator.
        state.governance.covenants=[];
        assert.equal((await h.execute({type:'save',node:'entry',state},()=>false)).status,gated?'denied':'committed');
        assert.equal(events.some(e=>e.event.forbidden),!gated);
      }finally{h.close();}
    }
  }finally{rmSync(dir,{recursive:true,force:true});}
});
