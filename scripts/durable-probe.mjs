// SPDX-License-Identifier: Apache-2.0
// Recovery-only synthetic host. Any prompt/provider/tool use is a test failure.
import {readFileSync} from 'node:fs';
import {WorkflowStore,OwnerCoordinator} from '@psp-cdl/api-server/persistence';
import {SqliteBackend} from '@psp-cdl/api-server/sqlite';
import {DurableLlmLoop,LoopError} from '@psp-cdl/llmproxy';
import {McpDispatchGate,bindingDigest} from '@psp-cdl/mcpproxy';
const options=JSON.parse(readFileSync(0,'utf8')),events=[];
const unexpected=()=>{throw Error('Unexpected inference/dispatch during recovery or lockdown');};
const host={authenticate:()=>({...options.actor,scopes:['sessions:read','sessions:write','models:invoke']}),now:()=>100,
  snapshot:(_p,s)=>({revision:'a1',policyVersion:s.policyVersion,registryRevision:'r1',providerId:'mock',providerRevision:'model-1',expires:190,releaseSources:[],releaseComplete:true}),
  prompt:unexpected,verification:unexpected,policy:unexpected,authorizeFinal:unexpected,planTurn:unexpected,authorizeTransition:unexpected,
  audit:(_p,event)=>{events.push(event);return true;},authorizeRecovery:()=>true,
  recoveryPolicy:(_p,b,r)=>({bindingDigest:bindingDigest(b),resources:[{classes:[],covenants:r.retained.covenants,capabilities:[],checks:{},parameters:{},context:{}}]})};
const backend=new SqliteBackend(process.argv[2],'peer-epoch',host.now);
try {
  const store=new WorkflowStore(backend,{resumeSecret:new Uint8Array(32).fill(42),authorizePersistence:()=>true,coordinator:new OwnerCoordinator(),durableTurns:true});
  const gate=new McpDispatchGate(store,host,'r1',[]);
  const loop=new DurableLlmLoop(store,gate,host,{id:'mock',revision:'model-1',complete:true,sources:[],invoke:unexpected},{postCompletion:'lockdown'});
  const recovered=await loop.recover('synthetic',options.sessionId,options.requestId,{deadline:180,cancelled:()=>false});
  let denied;
  try {await loop.run('synthetic',options.sessionId,{message:'Try to continue.'},{deadline:180,cancelled:()=>false,maxSteps:1,requestId:'new',expectedVersion:2});}
  catch(e){if(!(e instanceof LoopError))throw e;denied={code:e.code,response:e.response};}
  console.log(JSON.stringify({recovered,denied,events}));
}finally{backend.close();}
