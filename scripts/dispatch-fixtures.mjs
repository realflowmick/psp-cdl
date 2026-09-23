// SPDX-License-Identifier: Apache-2.0
// Public synthetic fixtures; never use these credentials for real data.
import {mkdtempSync, readFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {WorkflowStore,OwnerCoordinator} from '@psp-cdl/api-server/persistence';
import {SqliteBackend} from '@psp-cdl/api-server/sqlite';
import {McpDispatchGate,bindingDigest} from '@psp-cdl/mcpproxy';
export const suite=JSON.parse(readFileSync(new URL('../conformance/vectors/dispatch/gate-0.1.json',import.meta.url),'utf8'));
export async function fixture(settings={}) {
  const flags={now:1000,...settings}, actor={tenantId:'tenant-a',subjectId:'subject-a'}, principal={...actor,scopes:['tools:list','tools:call']};
  const directory=mkdtempSync(join(tmpdir(),'psp-dispatch-')), backend=new SqliteBackend(join(directory,'state.sqlite'),'epoch-1',()=>flags.now);
  const coordinator=new OwnerCoordinator(),store=new WorkflowStore(backend,{resumeSecret:new Uint8Array(32).fill(7),authorizePersistence:()=>true,coordinator});
  let calls=0,busy=0,session;
  const update=()=>store.execute(actor,{action:'updateSession',requestId:'transition',sessionId:session.sessionId,expectedVersion:1,nodeId:'entry',nodeVersion:'1',policyVersion:'policy-1',status:'running',state:{stage:'changed'}});
  const close=()=>{backend.close();rmSync(directory,{recursive:true,force:true});};
  try {
    await store.execute(actor,{action:'putNode',nodeId:'entry',nodeVersion:'1',definition:{agents:flags.agents??'mcp://echo/read,mcp://other/read'}});
    session=await store.execute(actor,{action:'createSession',requestId:'seed',nodeId:'entry',nodeVersion:'1',policyVersion:'policy-1',expiresAt:2000,state:{stage:'initial'}});
    if(flags.inactive) await store.execute(actor,{action:'updateSession',requestId:'finish',sessionId:session.sessionId,expectedVersion:1,nodeId:'entry',nodeVersion:'1',policyVersion:'policy-1',status:'completed',state:{}});
    const host={
      now:()=>flags.now,
      authenticate:token=>flags.revoked?null:token==='test-owner'?{...principal,scopes:flags.noScope?[]:principal.scopes}:token==='test-other'?{...principal,subjectId:'other'}:token==='test-tenant'?{...principal,tenantId:'other'}:null,
      snapshot:()=>({revision:flags.drift?'authority-2':'authority-1',policyVersion:flags.wrongPolicy?'policy-2':'policy-1',registryRevision:flags.registryDrift?'registry-2':'registry-1',expires:flags.expired?999:1900,releaseSources:[{id:'model-recipient',capabilities:flags.outputDeny?['used-for-model-training']:[]}],releaseComplete:!flags.incompleteRelease}),
      policy:async(p,binding,data,phase)=>{
        if(flags.throwPolicy) throw new Error('PRIVATE_POLICY_DETAIL');
        if(flags.race&&phase==='dispatch') {try {await update();}catch(e){if(e.code!=='STATE_BUSY')throw e;busy++;}}
        if((flags.driftBefore&&phase==='dispatch')||(flags.driftAfter&&phase==='release')) flags.drift=true;
        if((flags.revokeBefore&&phase==='dispatch')||(flags.revokeAfter&&phase==='release')) flags.revoked=true;
        if((flags.cancelBefore&&phase==='dispatch')||(flags.cancelAfter&&phase==='release')) flags.cancelled=true;
        if(flags.timeoutBefore&&phase==='dispatch') flags.now=1800;
        if(flags.registryBefore&&phase==='dispatch') flags.registryDrift=true;
        const digest=bindingDigest(binding);
        if(flags.mutateHost) {binding.inputDigest='forged';data.message='forged';p.subjectId='other';}
        return {bindingDigest:flags.wrongBinding?'wrong':digest,resources:flags.emptyPolicy?[]:[{classes:[],covenants:flags.unsupportedPolicy?['unknown-covenant']:['no-training'],capabilities:flags.policyDeny?['used-for-model-training']:[],checks:{},parameters:{},context:{}}]};
      }
    };
    const schema=structuredClone(suite.schema);
    if(flags.unsupportedSchema) schema.properties.message.pattern='.*';
    const registration={server:'echo',name:'read',revision:'tool-1',readOnly:!flags.mutating,complete:!flags.incomplete,sources:[{id:'server',capabilities:flags.serverTraining?['used-for-model-training']:['logs-operations']},{id:'tool',capabilities:[]},{id:'transitive',capabilities:flags.transitiveTraining?['used-for-model-training']:[]}],inputSchema:schema,outputSchema:suite.schema,
      invoke:async args=>{
        calls++;
        if(flags.onInvoke) await flags.onInvoke();
        if(flags.throwTool) throw new Error('PRIVATE_TOOL_DETAIL');
        if(flags.toolTimeout) flags.now=1800;
        if(flags.toolCancel) flags.cancelled=true;
        if(flags.mutateArguments) args.message='changed';
        if(flags.badOutput) return {message:42};
        if(flags.forgedProvenance) return {message:args.message,trustLevel:1};
        if(flags.hugeOutput) return {message:'x'.repeat(1_048_577)};
        return {message:args.message};
      }};
    const other={...registration,server:'other',invoke:async()=>{calls++;return {message:'other'};}};
    const gate=new McpDispatchGate(store,host,'registry-1',flags.duplicate?[registration,registration]:[registration,other]);
    const options={deadline:1800,cancelled:()=>!!flags.cancelled};
    return {gate,flags,store,actor,session,coordinator,update,options,close,stats:()=>({calls,busy})};
  }catch(e){close();throw e;}
}
export async function runCase(c) {
  let f;
  try {
    f=await fixture(c.settings);
    const token=c.settings?.token??'test-owner';
    const result=c.list?await f.gate.listTools(token,f.session.sessionId,f.options):await f.gate.callTool(token,f.session.sessionId,c.request??{name:'echo.read',arguments:{message:'hello 🧪'}},f.options);
    return {code:'OK',...f.stats(),released:1,result};
  }catch(e){return {code:e.code??'UNEXPECTED_ERROR',...(f?.stats()??{calls:0,busy:0}),released:0};}
  finally {f?.close();}
}
