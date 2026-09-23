// SPDX-License-Identifier: Apache-2.0
import {readFileSync} from 'node:fs';
import {fixture as llmFixture} from './llm-fixtures.mjs';
import {DurableLlmLoop} from '@psp-cdl/llmproxy';
import {bindingDigest} from '@psp-cdl/mcpproxy';
import {StoreError} from '@psp-cdl/api-server/persistence';
export const suite=JSON.parse(readFileSync(new URL('../conformance/vectors/llm/durable-0.1.json',import.meta.url),'utf8'));
export async function fixture(settings={}) {
  const f=await llmFixture({...settings,base:{...settings.base,durableTurns:!settings.disabledStore}}),events=[],commands=[];
  const authenticate=f.host.authenticate;
  f.host.authenticate=t=>{const p=authenticate(t);return p?{...p,scopes:[...p.scopes,...(f.flags.noReadScope?[]:['sessions:read']),...(f.flags.noWriteScope?[]:['sessions:write'])]}:null;};
  const host={...f.loopHost,
    planTurn:(_p,_b,d)=>{
      if(f.flags.throwPlan)throw new Error('PRIVATE_PLAN_DETAIL');
      if(f.flags.badPlan)return {state:{},complete:'yes',retained:{}};
      return {state:{answer:d.candidate.text,...(f.flags.forgedState?{llmCompletion:{policy:'lockdown'}}:{})},retained:{covenants:f.flags.retainedDisplay?['no-display-to-operator']:['no-training']},complete:!f.flags.continueTurn};
    },
    authorizeTransition:async(p,c)=>{
      commands.push(structuredClone(c.command));
      if(f.flags.transitionDrift)f.baseFlags.drift=true;
      if(f.flags.transitionCancel)f.baseFlags.cancelled=true;
      if(f.flags.transitionRevoke)f.baseFlags.revoked=true;
      if(f.flags.transitionExpiry)f.baseFlags.now=1700;
      if(f.flags.transitionRace){try{await f.update();}catch(e){if(e.code!=='STATE_BUSY')throw e;events.push({signal:'STATE_BUSY'});}}
      if(f.flags.mutateTransition){p.subjectId='forged';c.command.state={forged:true};c.result.output.text='forged';}
      if(f.flags.throwTransition)throw new Error('PRIVATE_TRANSITION_DETAIL');
      return !f.flags.denyTransition;
    },
    audit:(_p,event)=>{events.push(event);if(f.flags.throwAudit)throw new Error('PRIVATE_AUDIT_DETAIL');return !f.flags.denyAudit;},
    authorizeRecovery:()=>{if(f.flags.recoveryDrift)f.baseFlags.drift=true;if(f.flags.recoveryRevoke)f.baseFlags.revoked=true;return !f.flags.denyRecovery;},
    recoveryPolicy:(_p,b,r)=>({bindingDigest:f.flags.wrongRecoveryBinding?'wrong':bindingDigest(b),resources:f.flags.emptyRecovery?[]:[{classes:[],covenants:f.flags.unsupportedRecovery?['unknown-term']:r.retained.covenants,capabilities:f.flags.denyRecoveryPolicy?['used-for-model-training']:[],checks:{},parameters:{},context:{}}]}),
    policy:async(p,b,d,phase)=>{
      const result=await f.loopHost.policy(p,b,d,phase);
      if(f.flags.denyAfterCommit&&b.committedVersion)result.resources[0].capabilities=['used-for-model-training'];
      return result;
    }
  };
  const commit=f.backend.commit.bind(f.backend);
  f.backend.commit=async(...args)=>{
    const turn=args[2].some(w=>w.body.profile==='PSP-LLM-DURABLE-0.1');
    if(turn&&f.flags.failBeforeCommit)throw new StoreError('STORE_FAILURE');
    const ok=await commit(...args);
    if(turn&&ok){if(f.flags.cancelAfterCommit)f.baseFlags.cancelled=true;if(f.flags.driftAfterCommit)f.baseFlags.drift=true;if(f.flags.failAfterCommit)throw new StoreError('STORE_FAILURE');}
    return ok;
  };
  f.baseFlags.denyPersistence=!!f.flags.denyStorage;
  try {
    const loop=new DurableLlmLoop(f.store,f.gate,host,f.provider,{postCompletion:settings.postCompletion??'lockdown'});
    return {...f,loop,host,events,commands,options:{...f.options,requestId:'turn-1',expectedVersion:1}};
  }catch(e){f.close();throw e;}
}
export async function runCase(c) {
  let f;const steps=[];
  try {
    f=await fixture(c.settings);
    for(const step of c.steps??[{action:'run'}]) {
      Object.assign(f.flags,step.flags??{});Object.assign(f.baseFlags,step.baseFlags??{});
      const options={...f.options,...step.options},token=step.token??'test-owner';
      try {
        const value=step.action==='recover'?await f.loop.recover(token,f.session.sessionId,step.requestId??'turn-1',options):
          await f.loop.run(token,f.session.sessionId,step.request??{message:'Read synthetic data.'},options);
        steps.push({code:'OK',value});
      }catch(e){steps.push({code:e.code??'UNEXPECTED_ERROR',...(e.response?{response:e.response}:{})});}
    }
    const state=await f.store.execute(f.actor,{action:'getSession',sessionId:f.session.sessionId});
    return normalize({steps,codes:steps.map(s=>s.code),released:steps.filter(s=>s.code==='OK').length,...f.stats(),version:state.version,status:state.status,completion:state.llmCompletion??null,state:state.state,events:f.events,commands:f.commands,audits:f.events.filter(e=>e.signal==='post_completion_override_attempt').length,transitions:f.commands.length},f.session.sessionId);
  }catch(e){return {code:e.code??'UNEXPECTED_ERROR'};}
  finally{f?.close();}
}
export function normalize(value,sessionId){return JSON.parse(JSON.stringify(value).replaceAll(sessionId,'<session>'));}
