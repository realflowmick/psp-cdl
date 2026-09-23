// SPDX-License-Identifier: Apache-2.0
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {fixture as durableFixture} from './durable-fixtures.mjs';
import {RedirectingLlmLoop} from '@psp-cdl/llmproxy';
import {bindingDigest} from '@psp-cdl/mcpproxy';
export const suite=JSON.parse(readFileSync(new URL('../conformance/vectors/llm/redirect-0.1.json',import.meta.url),'utf8'));
export async function fixture(settings={}) {
  const f=await durableFixture({...settings,postCompletion:'lockdown',base:{...settings.base,redirectTurns:!settings.disabledRedirect}});
  const saved=f.baseFlags.denyPersistence;f.baseFlags.denyPersistence=false;
  try {await f.store.execute(f.actor,{action:'putNode',nodeId:'support',nodeVersion:'1',definition:{type:'application',agents:''}});}finally{f.baseFlags.denyPersistence=saved;}
  const resolutions=[],policies=[];
  const plan=f.host.planTurn;
  f.host.planTurn=(p,b,d)=>{const result=plan(p,b,d);result.state.threatState={score:99,marker:'SOURCE_ONLY'};return result;};
  const host={...f.host,
    resolveRedirect:(p,b,target)=>{
      resolutions.push({p:structuredClone(p),binding:structuredClone(b),target});
      if(f.flags.throwResolve)throw new Error('PRIVATE_RESOLVER_DETAIL');
      if(f.flags.badResolve)return {};
      if(f.flags.mutateResolve){p.subjectId='forged';b.sessionId='forged';}
      return {nodeId:f.flags.sameTarget?'entry':f.flags.missingTarget?'missing':'support',nodeVersion:'1',policyVersion:'target-policy',expiresAt:f.flags.expiredTarget?1000:f.flags.longTarget?2001:1600,...(f.flags.resolveOwner?{subjectId:'other'}:{})};
    },
    redirectPolicy:(p,b,data)=>{
      policies.push({binding:structuredClone(b),data:structuredClone(data)});
      if(f.flags.throwRedirect)throw new Error('PRIVATE_REDIRECT_DETAIL');
      if(f.flags.redirectCancel)f.baseFlags.cancelled=true;
      if(f.flags.redirectRevoke)f.baseFlags.revoked=true;
      if(f.flags.redirectDrift)f.baseFlags.drift=true;
      if(f.flags.redirectExpiry)f.baseFlags.now=1600;
      const digest=bindingDigest(b),covenants=f.flags.unknownRedirect?['unknown-term']:data.retained.covenants;
      if(f.flags.mutateRedirect){p.subjectId='forged';b.redirect.sessionId='forged';data.output.text='forged';}
      return {bindingDigest:f.flags.wrongRedirectBinding?'wrong':digest,resources:f.flags.emptyRedirect?[]:[{classes:[],covenants,capabilities:f.flags.denyRedirect?['used-for-model-training']:[],checks:{},parameters:{},context:{}}]};
    }
  };
  try {return {...f,host,resolutions,policies,loop:new RedirectingLlmLoop(f.store,f.gate,host,f.provider,settings.configuration??{postCompletion:'redirect',target:'mcp://realflow/applications/support'})};}
  catch(e){f.close();throw e;}
}
export function sessions(f) {
  const db=new DatabaseSync(join(f.directory,'state.sqlite'));
  try{return db.prepare("SELECT body FROM psp_records WHERE kind='session' ORDER BY record_key").all().map(r=>JSON.parse(r.body));}finally{db.close();}
}
export async function runCase(c) {
  let f;const steps=[];
  try {
    f=await fixture(c.settings);
    for(const step of c.steps??[{action:'run'}]) {
      Object.assign(f.flags,step.flags??{});Object.assign(f.baseFlags,step.baseFlags??{});
      const options={...f.options,...step.options},token=step.token??'test-owner';
      try {const value=step.action==='recover'?await f.loop.recover(token,f.session.sessionId,step.requestId??'turn-1',options):await f.loop.run(token,f.session.sessionId,step.request??{message:'Read synthetic data.'},options);steps.push({code:'OK',value});}
      catch(e){steps.push({code:e.code??'UNEXPECTED_ERROR'});}
    }
    const all=sessions(f),source=all.find(s=>s.sessionId===f.session.sessionId),targets=all.filter(s=>s.sessionId!==f.session.sessionId);
    for(const policy of f.policies) {
      const command=f.commands.find(c=>c.requestId===policy.binding.requestId);
      if(policy.binding.commandDigest!==bindingDigest(command))throw Error('Unbound redirect policy');
      policy.binding.commandDigest='<command-digest>';
    }
    for(const {binding} of [...f.policies,...f.resolutions]) {
      if(binding.promptDigest!==bindingDigest(await f.host.prompt(f.actor,binding)))throw Error('Unbound prompt');
      binding.promptDigest='<prompt-digest>';
    }
    let text=JSON.stringify({steps,codes:steps.map(s=>s.code),targets:targets.length,version:source.version,...f.stats(),source,targetSessions:targets,commands:f.commands,policies:f.policies,resolutions:f.resolutions,requests:f.requests});
    text=text.replaceAll(f.session.sessionId,'<source>');
    for(const target of targets)text=text.replaceAll(target.sessionId,'<target>');
    // Denied proposed targets are random as well; no record was committed.
    for(const policy of f.policies)text=text.replaceAll(policy.binding.redirect.sessionId,'<target>');
    return JSON.parse(text);
  }catch(e){return {code:e.code??'UNEXPECTED_ERROR'};}
  finally{f?.close();}
}
