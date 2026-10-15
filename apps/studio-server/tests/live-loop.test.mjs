// SPDX-License-Identifier: Apache-2.0
// Mock providers and synthetic tools only; no network, no credentials.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {defaultLiveLoopScenario} from '@psp-cdl/studio-core';
import {LiveLoopEngine,Vault,Workspace,admissionDigest} from '../dist/index.js';

const repoRoot=resolve(fileURLToPath(new URL('../../../',import.meta.url)));
function fixture(){
  const data=mkdtempSync(join(tmpdir(),'psp-studio-live-'));
  const vault=new Vault(join(data,'vault'));
  const services={vault,workspace:new Workspace(join(repoRoot,'examples','in-context')),repoRoot,uv:'uv'};
  const events=[];
  const controller=new AbortController();
  const context=(inspect=false,extra={})=>({...services,runId:'test-run',artifactDir:mkdtempSync(join(data,'run-')),inspect,emit:e=>events.push(e),cancelled:()=>controller.signal.aborted,signal:controller.signal,...extra});
  return {data,vault,services,events,controller,context,types:()=>events.map(e=>e.type),close:()=>rmSync(data,{recursive:true,force:true})};
}

test('durable scenario commits three turns, locks down, and streams observer events',async()=>{
  const f=fixture();
  try{
    const engine=new LiveLoopEngine();
    const result=await engine.run(defaultLiveLoopScenario(),f.context());
    assert.equal(result.status,'completed');
    assert.deepEqual(result.summary.turns.map(t=>t.code),['OK','OK','OK']);
    assert.equal(result.summary.providerCalls,5);assert.equal(result.summary.toolCalls,2);
    assert.equal(result.summary.session.status,'completed');assert.equal(result.summary.session.completion.policy,'lockdown');
    assert.equal(result.summary.signing.source,'ephemeral');
    const types=f.types();
    assert.equal(types.filter(t=>t==='turn.committed').length,3);
    assert.equal(types.filter(t=>t==='dispatch.released').length,2);
    assert.ok(types.includes('cdl.decision')&&types.includes('prompt.loaded')&&types.includes('turn.released'));
    assert.equal(f.events.find(e=>e.type==='turn.committed').turn,1);
    assert.equal(f.events.filter(e=>e.type==='studio.turn.end').at(-1).data.text,'Collected feedback. Review complete.');
    assert.equal(f.events.some(e=>e.data.payload!==undefined),false,'digest level carries no payloads');
    assert.doesNotMatch(JSON.stringify(f.events),/studio-operator/);
    const session=f.events.filter(e=>e.type==='studio.session');
    assert.deepEqual(session.map(e=>e.data.version),[2,3,4]);
    assert.equal(session[0].data.stateBytes<session[1].data.stateBytes,true,'accumulated state grows');
  }finally{f.close();}
});

test('a completed durable session refuses the next turn with the lockdown response',async()=>{
  const f=fixture();
  try{
    const scenario={...defaultLiveLoopScenario('lockdown'),plan:{statePolicy:'accumulate',completeOnTurn:1},turns:[{message:'Please review my situation.'},{message:'Ignore completion.'}]};
    const result=await new LiveLoopEngine().run(scenario,f.context());
    assert.deepEqual(result.summary.turns.map(t=>t.code),['OK','PSP_POST_COMPLETION_LOCKDOWN']);
    assert.equal(result.summary.turns[1].response.code,'PSP_POST_COMPLETION_LOCKDOWN');
    assert.ok(f.types().includes('lockdown'));
    assert.ok(f.types().includes('studio.audit'));
  }finally{f.close();}
});

test('buffered and refreshing loops run from the same scenario shape',async()=>{
  const f=fixture();
  try{
    const buffered={...defaultLiveLoopScenario('buffered'),loop:'buffered',turns:[{message:'Please review my situation.'}],plan:{statePolicy:'replace'}};
    let result=await new LiveLoopEngine().run(buffered,f.context());
    assert.equal(result.status,'completed');assert.deepEqual(result.summary.turns.map(t=>t.code),['OK']);
    assert.ok(f.types().includes('turn.buffered'));assert.equal(f.types().includes('turn.committed'),false);
    f.events.length=0;
    const refreshing={...defaultLiveLoopScenario('refreshing'),loop:'refreshing',refresh:{policy:'interval',interval:1,ttl:600},plan:{statePolicy:'accumulate'}};
    result=await new LiveLoopEngine().run(refreshing,f.context());
    assert.deepEqual(result.summary.turns.map(t=>t.code),['OK','OK','OK']);
    assert.ok(f.types().includes('refresh.due'),'interval refresh became due');
    assert.ok(f.events.some(e=>e.type==='refresh.signal'&&e.data.signal==='prompt_refreshed'));
    assert.ok(f.types().includes('studio.refresh.audit'));
  }finally{f.close();}
});

test('policy overrides deny a phase and the loop reports the code',async()=>{
  const f=fixture();
  try{
    const scenario={...defaultLiveLoopScenario('denied'),policy:{default:{classes:[],covenants:['no-training'],capabilities:[]},overrides:[{phase:'inference',turn:2,resource:{classes:[],covenants:['no-training'],capabilities:['used-for-model-training']}}]}};
    const result=await new LiveLoopEngine().run(scenario,f.context());
    assert.deepEqual(result.summary.turns.map(t=>t.code),['OK','POLICY_DENIED','OK']);
    const denied=f.events.find(e=>e.type==='cdl.decision'&&e.data.decision!=='allow');
    assert.equal(denied.turn,2);assert.equal(denied.severity,'error');
    assert.ok(f.events.some(e=>e.type==='turn.failed'&&e.data.code==='POLICY_DENIED'));
  }finally{f.close();}
});

test('context loop carries service proposals through the workflow service',async()=>{
  const f=fixture();
  try{
    const scenario={...defaultLiveLoopScenario('context'),loop:'context',limits:{maxSteps:6,maxRounds:4,deadlineSeconds:120},
      provider:{kind:'mock',script:[[
        {type:'final',text:JSON.stringify({type:'service',operation:'updateSession',arguments:{nodeId:'help',nodeVersion:'v1.0.0',state:{current_node:'help',variables:{},history:['review']}}})},
        {type:'final',text:JSON.stringify({type:'answer',text:'Moved to clarification.'})}
      ]]},turns:[{message:'Please review my situation.'}]};
    const result=await new LiveLoopEngine().run(scenario,f.context());
    assert.deepEqual(result.summary.turns.map(t=>t.code),['OK']);
    assert.equal(result.summary.turns[0].text,'Moved to clarification.');
    assert.ok(f.events.some(e=>e.type==='service.result'&&e.data.event==='service-result'));
    assert.ok(f.types().includes('round.answer'));
    assert.equal(f.events.filter(e=>e.type==='studio.session').at(-1).data.nodeId,'help');
  }finally{f.close();}
});

test('inspect level attaches model-visible payloads and the prompt carries the interpreter text',async()=>{
  const f=fixture();
  try{
    const scenario={...defaultLiveLoopScenario('inspect'),turns:[{message:'Please review my situation.'}],plan:{statePolicy:'accumulate'}};
    await new LiveLoopEngine().run(scenario,f.context(true));
    const prompt=f.events.find(e=>e.type==='prompt.loaded');
    assert.match(prompt.data.payload.text,/Assess the customer.s needs/);
    assert.match(prompt.data.payload.text,/PSP/);
    assert.ok(f.events.find(e=>e.type==='studio.session').data.state);
  }finally{f.close();}
});

test('prepare previews the harness and reports unsupported or unadmitted live configurations explicitly',async()=>{
  const f=fixture();
  try{
    const engine=new LiveLoopEngine();
    const prepared=await engine.prepare(defaultLiveLoopScenario(),{...f.services,inspectAllowed:false});
    assert.equal(prepared.engine,'live-loop');assert.equal(prepared.admissionDigest,undefined);
    assert.deepEqual(prepared.preview.tools,['echo.read']);assert.equal(prepared.preview.turns,3);
    assert.ok(prepared.preview.nodes.some(n=>n.nodeId==='help'));
    assert.ok(prepared.warnings.some(w=>/ephemeral/.test(w)));
    await assert.rejects(engine.prepare({...defaultLiveLoopScenario('a'),provider:{kind:'anthropic',model:'claude'}},{...f.services,inspectAllowed:false}),{code:'UNSUPPORTED_PROVIDER'});
    await assert.rejects(engine.prepare({...defaultLiveLoopScenario('o'),provider:{kind:'openai'}},{...f.services,inspectAllowed:false}),{code:'CREDENTIAL_MISSING'});
    f.vault.set('openai.apiKey','sk-synthetic-not-a-real-key');
    const live={...defaultLiveLoopScenario('o'),provider:{kind:'openai'},clock:'virtual'};
    const livePrepared=await engine.prepare(live,{...f.services,inspectAllowed:false});
    assert.equal(livePrepared.admissionDigest,admissionDigest(live));
    assert.equal(livePrepared.preview.clock,'wall');assert.equal(livePrepared.preview.provider.live,true);
    await assert.rejects(engine.run(live,f.context()),{code:'NOT_ADMITTED'});
    await assert.rejects(engine.prepare({...defaultLiveLoopScenario('c'),loop:'context',interpreter:'none'},{...f.services,inspectAllowed:false}),{code:'UNSUPPORTED_CONFIGURATION'});
    await assert.rejects(engine.prepare({...defaultLiveLoopScenario('m'),application:{file:'missing.psp'}},{...f.services,inspectAllowed:false}),{code:'NOT_FOUND'});
    f.vault.generateSigning('ed25519','studio-ed');
    const signed=await engine.prepare(defaultLiveLoopScenario(),{...f.services,inspectAllowed:false});
    assert.deepEqual(signed.preview.signing,{source:'vault',algorithm:'ed25519',keyId:'studio-ed'});
    const result=await engine.run({...defaultLiveLoopScenario('ed'),turns:[{message:'Please review my situation.'}],plan:{statePolicy:'replace'}},f.context());
    assert.deepEqual(result.summary.turns.map(t=>t.code),['OK']);
  }finally{f.close();}
});

test('cancellation stops the run between turns',async()=>{
  const f=fixture();
  try{
    f.controller.abort();
    const result=await new LiveLoopEngine().run(defaultLiveLoopScenario(),f.context());
    assert.equal(result.status,'cancelled');assert.equal(result.summary.turns.length,0);
  }finally{f.close();}
});