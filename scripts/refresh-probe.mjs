// SPDX-License-Identifier: Apache-2.0
// Synthetic process-restart host; no real provider, credential or customer data.
import {readFileSync} from 'node:fs';
import {WorkflowStore,OwnerCoordinator} from '@psp-cdl/api-server/persistence';
import {SqliteBackend} from '@psp-cdl/api-server/sqlite';
import {signEnvelope} from '@psp-cdl/core/crypto';
import {RefreshingLlmLoop,promptContext} from '@psp-cdl/llmproxy';
import {McpDispatchGate,bindingDigest} from '@psp-cdl/mcpproxy';
const options=JSON.parse(readFileSync(0,'utf8')),requests=[],refreshes=[],events=[];
const key=new Uint8Array(32).fill(19),sign=(b,version,timestamp,expires)=>signEnvelope('System '+version,{
  algorithm:'hmac-sha256',signatureVersion:'2.0',secretId:'test-signing-key',timestamp,expires,version,sectionType:'system',contentType:'text',
  attributes:{...promptContext(b),'refresh-policy':'interval|expiration','refresh-interval':'1','refresh-grace':'10'}
},key);
const host={authenticate:t=>t==='synthetic'?{...options.actor,scopes:['sessions:read','sessions:write','models:invoke','tools:list','tools:call']}:null,now:()=>options.now,
  snapshot:(_p,s)=>({revision:'a1',policyVersion:s.policyVersion,registryRevision:'r1',providerId:'mock',providerRevision:'model-1',expires:190,releaseSources:[],releaseComplete:true}),
  prompt:(_p,b)=>sign(b,b.refresh?.current_version??'1.0.0',90,150),
  verification:()=>({keys:[{id:'test-signing-key',algorithm:'hmac-sha256',material:key,status:'active',trustLevels:[2],sectionTypes:['system'],scope:{},allowUnscoped:false}]}),
  policy:(_p,b)=>({bindingDigest:bindingDigest(b),resources:[{classes:[],covenants:['no-training'],capabilities:[],checks:{},parameters:{},context:{}}]}),
  authorizeFinal:()=>true,planTurn:()=>({state:{done:false},retained:{covenants:['no-training']},complete:false}),authorizeTransition:()=>true,
  audit:()=>true,authorizeRecovery:()=>true,
  refresh:(_p,b,r)=>{refreshes.push(r);return sign(b,options.nextVersion??'1.0.1',options.now,options.now+50);},
  authorizeRefresh:()=>true,auditRefresh:(_p,e)=>{events.push(e);return true;}
};
host.recoveryPolicy=host.policy;
const backend=new SqliteBackend(process.argv[2],'peer-epoch',host.now);
try {
  const store=new WorkflowStore(backend,{resumeSecret:new Uint8Array(32).fill(42),authorizePersistence:()=>true,coordinator:new OwnerCoordinator(),durableTurns:true,promptRefresh:true});
  const gateHost={...host,snapshot:(p,s)=>{const {providerId,providerRevision,...a}=host.snapshot(p,s);return a;}};
  const gate=new McpDispatchGate(store,gateHost,'r1',[]);
  const loop=new RefreshingLlmLoop(store,gate,host,{id:'mock',revision:'model-1',complete:true,sources:[],invoke:r=>{requests.push(r);return {type:'final',text:'Finished 🧪'};}},{postCompletion:'lockdown'});
  const controls={deadline:190,cancelled:()=>false,maxSteps:1,requestId:options.requestId,expectedVersion:options.expectedVersion};
  const result=options.recover?await loop.recover('synthetic',options.sessionId,options.requestId,controls):await loop.run('synthetic',options.sessionId,{message:'Continue.'},controls);
  const prompt=await store.execute(options.actor,{action:'getPromptState',sessionId:options.sessionId});
  console.log(JSON.stringify({result,prompt,requests,refreshes,events}));
}finally{backend.close();}
