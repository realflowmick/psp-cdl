// SPDX-License-Identifier: Apache-2.0
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {RevisionedToolRegistry,REVISION_KEY,revisionDigest} from '@psp-cdl/mcp-server/revision';
import {suite as dispatch} from './dispatch-fixtures.mjs';
export const suite=JSON.parse(readFileSync(new URL('../conformance/vectors/dispatch/revision-0.1.json',import.meta.url),'utf8'));
export const principal={tenantId:'downstream',subjectId:'host',scopes:['tools:list','tools:call']};
export const approval={name:'read',revision:'tool-1',readOnly:true,complete:true,sources:[{id:'host-review',capabilities:[]}],inputSchema:dispatch.schema,outputSchema:dispatch.schema};
export function tool(invoke,revision='tool-1') {return {name:'read',revision,readOnly:true,inputSchema:dispatch.schema,outputSchema:dispatch.schema,invoke};}
export function revisionPeer(mode='ok',spy=()=>{},revision='tool-1') {
  let lists=0;
  const tools=[tool(args=>{spy();return args;},revision)];
  const registry=new RevisionedToolRegistry({authenticate:t=>t==='test-downstream'?principal:null,authorize:(_p,_n,phase)=>{
    if(mode==='race'&&phase==='invoke')registry.publish(registry.revision,tools);
    return true;
  }},tools);
  return {registry,service:(cancelled=()=>false)=>{
    const service=registry.service(cancelled),r=service.revisions;
    if(mode==='unsupported'){delete service.revisions;return service;}
    service.revisions={...r,discover:async(...args)=>{
      lists++;
      if(mode==='drift'&&lists===2)registry.publish(registry.revision,tools);
      const result=await r.discover(...args);
      if(mode==='bad-catalog')result._meta[REVISION_KEY].catalogDigest='0'.repeat(64);
      return result;
    },callTool:async(...args)=>{
      const result=await r.callTool(...args);
      if(mode==='missing-receipt')delete result.meta;
      if(mode==='forged-receipt')result.meta[REVISION_KEY].generation++;
      return result;
    }};
    return service;
  }};
}
export async function runRevisionCase(c) {
  let calls=0,released=0,code='OK',cancelled=c.id==='cancel-before',registry;
  const capture=work=>{try{work();}catch(e){code=e.code??'TOOL_ERROR';}};
  const tools=[tool(args=>{calls++;if(c.id==='busy-invoke')capture(()=>registry.publish(registry.revision,tools));if(c.id==='cancel-after')cancelled=true;if(c.id==='lease-failure')throw Error('private');return args;})];
  const host={authenticate:()=>({...principal,...(c.id==='identity-change'?{subjectId:'other'}:{}),...(c.id==='no-scope'?{scopes:[]}:{} )}),authorize:(_p,_n,phase)=>{
    if(c.id==='race-before-select'&&phase==='invoke')registry.publish(registry.revision,tools);
    if(c.id==='busy-release'&&phase==='release')capture(()=>registry.publish(registry.revision,tools));
    return c.id!=='deny-'+phase;
  }};
  registry=new RevisionedToolRegistry(host,tools,'fixture-epoch');
  const args={message:'hello 🧪'},pre={...registry.revision,toolRevision:'tool-1',inputDigest:revisionDigest(args),...c.patch};
  try {
    if(c.id==='aba') {registry.publish(registry.revision,[]);registry.publish(registry.revision,tools);}
    if(c.id==='publish-conflict')capture(()=>registry.publish({...registry.revision,generation:2},[]));
    if(c.id==='invalid-candidate')capture(()=>registry.publish(registry.revision,[{...tools[0],readOnly:false}]));
    const service=registry.service(()=>cancelled);
    const result=c.id==='no-negotiation'?await service.callTool('read',args,'test-downstream',principal):await service.revisions.callTool(c.id==='unknown-tool'?'missing':'read',args,'test-downstream',principal,c.id==='missing'?null:pre);
    assert.deepEqual(result,{data:args,meta:{[REVISION_KEY]:pre}});released=1;
  }catch(e){code=e.code??'TOOL_ERROR';}
  if(c.id==='lease-failure')registry.publish(registry.revision,tools);
  return {code,calls,released,generation:registry.revision.generation};
}
if(process.argv.includes('--emit'))console.log(JSON.stringify(await Promise.all(suite.cases.map(runRevisionCase))));
