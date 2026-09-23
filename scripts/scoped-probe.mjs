// SPDX-License-Identifier: Apache-2.0
// Fresh-process host: workflow prompt/tool use is always a test failure.
import {readFileSync} from 'node:fs';
import {WorkflowStore,OwnerCoordinator} from '@psp-cdl/api-server/persistence';
import {SqliteBackend} from '@psp-cdl/api-server/sqlite';
import {ScopedLlmLoop,scopedPromptContext,LoopError} from '@psp-cdl/llmproxy';
import {McpDispatchGate,bindingDigest} from '@psp-cdl/mcpproxy';
import {signEnvelope} from '@psp-cdl/core/crypto';
const options=JSON.parse(readFileSync(0,'utf8')),calls=[],boundaries=[],system='Discuss only the completed synthetic results.';
const unexpected=()=>{throw Error('Unexpected workflow callback after completion');};
const resource={classes:[],covenants:['no-training'],capabilities:[],checks:{},parameters:{},context:{}};
const host={authenticate:()=>({...options.actor,scopes:['sessions:read','sessions:write','models:invoke']}),now:()=>100,
  snapshot:(_p,s)=>({revision:'a1',policyVersion:s.policyVersion,registryRevision:'r1',providerId:'mock',providerRevision:'model-1',expires:190,releaseSources:[],releaseComplete:true}),
  prompt:unexpected,planTurn:unexpected,applicationThreat:unexpected,
  verification:()=>({keys:[{id:'test',algorithm:'hmac-sha256',material:new Uint8Array(32).fill(19),status:'active',trustLevels:[2],sectionTypes:['system'],scope:{},allowUnscoped:false}]}),
  scopedPrompt:(_p,b)=>signEnvelope(system,{algorithm:'hmac-sha256',signatureVersion:'2.0',secretId:'test',timestamp:0,expires:180,version:'1.0.0',sectionType:'system',contentType:'text',trustLevel:2,attributes:scopedPromptContext(b)},new Uint8Array(32).fill(19)),
  scopeBoundary:(_p,b,d)=>{boundaries.push(b.phase);const denied=b.phase==='ingress'&&d.request.message!=='Explain.';return {bindingDigest:bindingDigest(b),decision:denied?'deny':'allow',threatState:{...d.threatState,score:d.threatState.score+(denied?10:1)}};},
  policy:(_p,b)=>({bindingDigest:bindingDigest(b),resources:[resource]}),authorizeFinal:()=>true,authorizeTransition:()=>true,audit:()=>true,
  planScopedTurn:(_p,_b,d)=>({retained:d.retained}),authorizeRecovery:()=>!options.denyRecovery,
  recoveryPolicy:(_p,b,r)=>({bindingDigest:bindingDigest(b),resources:[{...resource,covenants:r.retained.covenants}]})};
const backend=new SqliteBackend(process.argv[2],'peer-epoch',host.now);
try {
  const store=new WorkflowStore(backend,{resumeSecret:new Uint8Array(32).fill(42),authorizePersistence:()=>true,coordinator:new OwnerCoordinator(),durableTurns:true,scopedTurns:true});
  const gate=new McpDispatchGate(store,host,'r1',[]),loop=new ScopedLlmLoop(store,gate,host,{id:'mock',revision:'model-1',complete:true,sources:[],invoke:r=>{calls.push(r);return {type:'final',text:'Peer scoped answer'};}},{postCompletion:'scoped',scope:{id:'results',version:'1',system,threatPolicy:null}});
  let result;const controls={deadline:180,cancelled:()=>false,maxSteps:1,requestId:options.requestId,expectedVersion:options.expectedVersion};
  try{result={code:'OK',value:options.mode==='recover'?await loop.recover('synthetic',options.sessionId,options.requestId,controls):await loop.run('synthetic',options.sessionId,{message:options.message??'Explain.'},controls)};}
  catch(e){if(!(e instanceof LoopError))throw e;result={code:e.code};}
  console.log(JSON.stringify({result,calls,boundaries,state:await store.execute(options.actor,{action:'getSession',sessionId:options.sessionId})}));
}finally{backend.close();}
