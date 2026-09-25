# SPDX-License-Identifier: Apache-2.0
"""Build/install private local artifacts and test them as downstream library consumers."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import uuid

ROOT = Path(__file__).resolve().parents[1]
RUN = ROOT / '.artifacts' / ('package-check-' + uuid.uuid4().hex[:10])
ARTIFACTS = RUN / 'artifacts'
CONSUMER = RUN / 'consumer'
PYTHON = RUN / 'python'
for path in (ARTIFACTS, CONSUMER, PYTHON):
    path.mkdir(parents=True)
NPM = shutil.which('npm.cmd' if os.name == 'nt' else 'npm')
UV = shutil.which('uv')
if not NPM or not UV:
    raise SystemExit('Put npm and uv on PATH before running package checks.')

def run(command, cwd=ROOT):
    result = subprocess.run(command, cwd=cwd, text=True, encoding='utf-8', capture_output=True)
    if result.returncode:
        raise SystemExit(' '.join(str(c) for c in command) + '\n' + result.stdout + result.stderr)
    return result.stdout

components = ('core', 'cdl', 'test-harness', 'api-server', 'mcp-server', 'mcpproxy', 'llmproxy')
for component in components:
    run([NPM, 'pack', '--workspace', '@psp-cdl/' + component, '--pack-destination', str(ARTIFACTS), '--ignore-scripts'])
    run([UV, 'build', '--package', 'psp-cdl-' + component, '--wheel', '--out-dir', str(ARTIFACTS), '--offline'])
packages = {f'@psp-cdl/{component}': 'file:' + (ARTIFACTS / f'psp-cdl-{component}-0.1.0-dev.0.tgz').as_posix() for component in components}
(CONSUMER / 'package.json').write_text(json.dumps({'private': True, 'type': 'module', 'dependencies': packages}), encoding='utf-8')
run([NPM, 'install', '--ignore-scripts', '--no-audit', '--no-fund'], CONSUMER)
node_source = r'''
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {resolve, sep} from 'node:path';
import * as core from '@psp-cdl/core';
import * as crypto from '@psp-cdl/core/crypto';
import * as cdl from '@psp-cdl/cdl';
import * as harness from '@psp-cdl/test-harness';
import {SecurityService} from '@psp-cdl/api-server';
import {createHttpServer} from '@psp-cdl/api-server/http';
import {McpServer} from '@psp-cdl/mcp-server';
import {serveStdio} from '@psp-cdl/mcp-server/stdio';
import {RevisionedToolRegistry,revisionDigest} from '@psp-cdl/mcp-server/revision';
import {WorkflowStore,OwnerCoordinator} from '@psp-cdl/api-server/persistence';
import {McpDispatchGate,bindingDigest} from '@psp-cdl/mcpproxy';
import {BufferedLlmLoop,DurableLlmLoop,RedirectingLlmLoop,RefreshingLlmLoop,ScopedLlmLoop,scopedPromptContext,promptContext,McpPromptRefresher,mcpRefreshToolDefinition} from '@psp-cdl/llmproxy';
import {PinnedMcpClient,StdioMcpClient,createMcpProxy,HttpMcpClient,McpHttpServer,createMcpProxyService} from '@psp-cdl/mcpproxy/mcp';
assert.equal(typeof HttpMcpClient.connect,'function');
import {SqliteBackend} from '@psp-cdl/api-server/sqlite';
import {WorkflowService} from '@psp-cdl/api-server/workflow';
import {SessionOperations} from '@psp-cdl/api-server/operations';
assert.equal(typeof WorkflowService,'function');assert.equal(typeof SessionOperations,'function');
for(const pkg of ['core','cdl','test-harness','api-server','mcp-server','mcpproxy','llmproxy']) assert(fileURLToPath(import.meta.resolve('@psp-cdl/'+pkg)).startsWith(resolve('node_modules')+sep));
const service=new SecurityService({authenticate:()=>null,resolve:()=>{throw new Error('must not resolve');},now:()=>1});
await assert.rejects(()=>service.invoke('evaluate',{operation_id:'op'},'invalid'),{code:'UNAUTHENTICATED'});
assert.equal((await new McpServer(service,()=> 'invalid').handle('{"jsonrpc":"2.0","id":1,"method":"ping"}')).error.message,'UNAUTHENTICATED');
assert.equal(typeof createHttpServer,'function');assert.equal(typeof serveStdio,'function');
const backend=new SqliteBackend(resolve('consumer.sqlite'),'package-test',()=>1);
try {
  const store=new WorkflowStore(backend,{resumeSecret:new Uint8Array(32).fill(42),authorizePersistence:()=>true,coordinator:new OwnerCoordinator(),durableTurns:true}); // Synthetic data only.
  const actor={tenantId:'synthetic-tenant',subjectId:'synthetic-subject'};
  await store.execute(actor,{action:'putNode',nodeId:'entry',nodeVersion:'1',definition:{text:'🧪',agents:'mcp://echo/read'}});
  const session=await store.execute(actor,{action:'createSession',requestId:'create',nodeId:'entry',nodeVersion:'1',policyVersion:'p1',expiresAt:10,state:{text:'🧪'}});
  assert.deepEqual(await store.execute(actor,{action:'getSession',sessionId:session.sessionId}),session);
  const schema={type:'object',properties:{message:{type:'string'}},required:['message'],additionalProperties:false};
  let calls=0;
  const host={authenticate:t=>t==='consumer'?{...actor,scopes:['tools:call','tools:list','models:invoke','sessions:read','sessions:write']}:null,now:()=>1,
    snapshot:()=>({revision:'a1',policyVersion:'p1',registryRevision:'r1',expires:9,releaseSources:[],releaseComplete:true}),
    policy:(_p,b)=>({bindingDigest:bindingDigest(b),resources:[{classes:[],covenants:[],capabilities:[],checks:{},parameters:{},context:{}}]})};
  const gate=new McpDispatchGate(store,host,'r1',[{server:'echo',name:'read',revision:'1',readOnly:true,sources:[],complete:true,inputSchema:schema,outputSchema:schema,invoke:a=>{calls++;return a;}}]);
  const output=await gate.callTool('consumer',session.sessionId,{name:'echo.read',arguments:{message:'🧪'}},{deadline:9,cancelled:()=>false});
  assert.equal(calls,1);assert.equal(output.data.message,'🧪');assert.equal(output.provenance.trustLevel,5);
  const loopKey=new Uint8Array(32).fill(19);
  const loopHost={...host,snapshot:()=>({...host.snapshot(),providerId:'mock',providerRevision:'1'}),
    prompt:(_p,b)=>crypto.signEnvelope('Synthetic system text',{algorithm:'hmac-sha256',signatureVersion:'2.0',secretId:'test',timestamp:0,expires:9,version:'1.0.0',sectionType:'system',contentType:'text',attributes:promptContext(b)},loopKey),
    verification:()=>({keys:[{id:'test',algorithm:'hmac-sha256',material:loopKey,status:'active',trustLevels:[2],sectionTypes:['system'],scope:{},allowUnscoped:false}]}),authorizeFinal:()=>true};
  let inference=0;
  const loop=new BufferedLlmLoop(store,gate,loopHost,{id:'mock',revision:'1',sources:[],complete:true,invoke:r=>{inference++;assert.equal(r.messages[0].content,'Synthetic system text');return inference===1?{type:'tool',name:'echo.read',arguments:{message:'installed-loop'}}:{type:'final',text:r.messages.at(-1).data.message};}});
  const answer=await loop.run('consumer',session.sessionId,{message:'read'},{deadline:9,cancelled:()=>false,maxSteps:3});
  assert.equal(answer.text,'installed-loop');assert.equal(inference,2);assert.equal(calls,2);
  const peer=await StdioMcpClient.connect({executable:process.execPath,args:[resolve('peer.mjs')],env:{},serverInfo:{name:'psp-cdl-reference',version:'0.1.0'},timeoutMs:2000});
  try {
    const remoteGate=new McpDispatchGate(store,host,'r1',peer.registrations('echo',[{name:'read',revision:'1',readOnly:true,sources:[],complete:true,inputSchema:schema,outputSchema:schema}],()=>1));
    const proxy=createMcpProxy(remoteGate,()=> 'consumer',session.sessionId,()=>({deadline:9,cancelled:()=>false}));
    await proxy.handle(JSON.stringify({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'consumer',version:'1'}}}));
    await proxy.handle('{"jsonrpc":"2.0","method":"notifications/initialized"}');
    const response=await proxy.handle('{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"echo.read","arguments":{"message":"installed"}}}');
    assert.equal(response.result.structuredContent.message,'installed');assert.equal(response.result._meta['psp-cdl/provenance'].trustLevel,5);
  }finally{await peer.close();}
  const endpoint='http://127.0.0.1:8123/mcp';
  const http=new McpHttpServer({authenticate:t=>host.authenticate(t),open:(_p,cancelled)=>({service:createMcpProxyService(gate,session.sessionId,()=>({deadline:9,cancelled})),close:()=>{}})},{endpoint,allowLoopbackHttp:true,authorizationServers:['https://issuer.example/'],maxSessions:2,sessionTtlMs:10000,callTimeoutMs:2000});
  const send=(message,sid)=>http.handle({method:'POST',path:'/mcp',headers:[['host','127.0.0.1:8123'],['authorization','Bearer consumer'],['content-type','application/json'],['accept','application/json, text/event-stream'],...(sid?[['mcp-session-id',sid]]:[])],body:Buffer.from(JSON.stringify(message))});
  const sid=(await send({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'installed',version:'1'}}})).headers['mcp-session-id'];
  await send({jsonrpc:'2.0',method:'notifications/initialized'},sid);
  const result=JSON.parse((await send({jsonrpc:'2.0',id:2,method:'tools/call',params:{name:'echo.read',arguments:{message:'installed-http'}}},sid)).body);
  assert.equal(result.result.structuredContent.message,'installed-http');http.close();
  const p={...actor,scopes:['tools:list','tools:call']};
  const revisions=new RevisionedToolRegistry({authenticate:()=>p,authorize:()=>true},[{name:'read',revision:'1',readOnly:true,inputSchema:schema,outputSchema:schema,invoke:a=>a}]);
  const pre={...revisions.revision,toolRevision:'1',inputDigest:revisionDigest({message:'installed-revision'})};
  assert.equal((await revisions.service().revisions.callTool('read',{message:'installed-revision'},'synthetic',p,pre)).data.message,'installed-revision');
  const durableHost={...loopHost,planTurn:()=>({state:{done:true},retained:{},complete:true}),authorizeTransition:()=>true,audit:()=>true,authorizeRecovery:()=>true,recoveryPolicy:host.policy};
  const durable=new DurableLlmLoop(store,gate,durableHost,{id:'mock',revision:'1',sources:[],complete:true,invoke:()=>({type:'final',text:'installed-durable'})},{postCompletion:'lockdown'});
  const controls={deadline:9,cancelled:()=>false,maxSteps:1,requestId:'durable',expectedVersion:1};
  assert.equal((await durable.run('consumer',session.sessionId,{message:'finish'},controls)).receipt.status,'completed');
  assert.equal((await durable.recover('consumer',session.sessionId,'durable',controls)).text,'installed-durable');
  await assert.rejects(()=>durable.run('consumer',session.sessionId,{message:'continue'},controls),{code:'PSP_POST_COMPLETION_LOCKDOWN'});
  const redirectStore=new WorkflowStore(backend,{resumeSecret:new Uint8Array(32).fill(42),authorizePersistence:()=>true,coordinator:new OwnerCoordinator(),durableTurns:true,redirectTurns:true});
  await redirectStore.execute(actor,{action:'putNode',nodeId:'support',nodeVersion:'1',definition:{type:'application'}});
  const redirectSession=await redirectStore.execute(actor,{action:'createSession',requestId:'redirect-session',nodeId:'entry',nodeVersion:'1',policyVersion:'p1',expiresAt:10,state:{}});
  const redirectGate=new McpDispatchGate(redirectStore,host,'r1',[]);
  const redirectHost={...durableHost,resolveRedirect:()=>({nodeId:'support',nodeVersion:'1',policyVersion:'p1',expiresAt:9}),redirectPolicy:host.policy};
  const redirectLoop=new RedirectingLlmLoop(redirectStore,redirectGate,redirectHost,{id:'mock',revision:'1',sources:[],complete:true,invoke:()=>({type:'final',text:'installed-redirect'})},{postCompletion:'redirect',target:'mcp://realflow/applications/support'});
  const redirected=await redirectLoop.run('consumer',redirectSession.sessionId,{message:'handoff'},{...controls,requestId:'redirect'});
  assert.equal((await redirectStore.execute(actor,{action:'getSession',sessionId:redirected.redirect.sessionId})).state.input.text,'installed-redirect');
  assert.deepEqual((await redirectLoop.recover('consumer',redirectSession.sessionId,'redirect',controls)).redirect,redirected.redirect);
  const scopedStore=new WorkflowStore(backend,{resumeSecret:new Uint8Array(32).fill(42),authorizePersistence:()=>true,coordinator:new OwnerCoordinator(),durableTurns:true,scopedTurns:true});
  const scopedSession=await scopedStore.execute(actor,{action:'createSession',requestId:'scoped-session',nodeId:'entry',nodeVersion:'1',policyVersion:'p1',expiresAt:10,state:{}});
  const scopedGate=new McpDispatchGate(scopedStore,host,'r1',[]),scopedRequests=[];
  const scopedHost={...durableHost,applicationThreat:()=>({policy:{id:'application-threat',version:'1'},state:{score:7}}),
    scopedPrompt:(_p,b)=>crypto.signEnvelope('Installed scoped SYSTEM',{algorithm:'hmac-sha256',signatureVersion:'2.0',secretId:'test',timestamp:0,expires:9,version:'1.0.0',sectionType:'system',contentType:'text',attributes:scopedPromptContext(b)},loopKey),
    scopeBoundary:(_p,b,d)=>({bindingDigest:bindingDigest(b),decision:'allow',threatState:{score:d.threatState.score+1}}),planScopedTurn:(_p,_b,d)=>({retained:d.retained})};
  const scopedLoop=new ScopedLlmLoop(scopedStore,scopedGate,scopedHost,{id:'mock',revision:'1',sources:[],complete:true,invoke:r=>{scopedRequests.push(r);return {type:'final',text:r.messages[0].content};}},{postCompletion:'scoped',scope:{id:'results',version:'1',system:'Installed scoped SYSTEM',threatPolicy:null}});
  await scopedLoop.run('consumer',scopedSession.sessionId,{message:'finish'},{...controls,requestId:'scoped-complete'});
  const scopedAnswer=await scopedLoop.run('consumer',scopedSession.sessionId,{message:'explain'},{...controls,requestId:'scoped-followup',expectedVersion:2});
  assert.equal(scopedAnswer.text,'Installed scoped SYSTEM');assert.equal(scopedAnswer.receipt.status,'completed');
  assert.deepEqual(scopedRequests[1].messages,[{role:'system',content:'Installed scoped SYSTEM'},{role:'assistant',content:'Synthetic system text'},{role:'user',content:'explain'}]);assert.deepEqual(scopedRequests[1].tools,[]);
  const scopedState=await scopedStore.execute(actor,{action:'getSession',sessionId:scopedSession.sessionId});
  assert.equal(scopedState.version,3);assert.equal(scopedState.llmCompletion.turnCount,1);assert.equal(scopedState.llmCompletion.threatState.score,9);assert.deepEqual(scopedState.state,{done:true});
  assert.equal((await scopedLoop.recover('consumer',scopedSession.sessionId,'scoped-followup',controls)).text,'Installed scoped SYSTEM');assert.equal(scopedRequests.length,2);
  const refreshStore=new WorkflowStore(backend,{resumeSecret:new Uint8Array(32).fill(42),authorizePersistence:()=>true,coordinator:new OwnerCoordinator(),durableTurns:true,promptRefresh:true});
  const refreshGate=new McpDispatchGate(refreshStore,host,'r1',[]);
  const refreshSession=await refreshStore.execute(actor,{action:'createSession',requestId:'refresh-session',nodeId:'entry',nodeVersion:'1',policyVersion:'p1',expiresAt:10,state:{}});
  const signRefresh=(b,version,timestamp)=>crypto.signEnvelope('System '+version,{algorithm:'hmac-sha256',signatureVersion:'2.0',secretId:'test',timestamp,expires:9,version,sectionType:'system',contentType:'text',attributes:{...promptContext(b),'refresh-policy':'interval','refresh-interval':'1','refresh-grace':'0'}},new Uint8Array(32).fill(19));
  const refreshHost={...durableHost,prompt:(_p,b)=>signRefresh(b,'1.0.0',0),refresh:(_p,b)=>signRefresh(b,'1.0.1',1),authorizeRefresh:()=>true,auditRefresh:()=>true,planTurn:()=>({state:{},retained:{},complete:false})};
  let refreshBinding;
  const refreshPrincipal=await refreshHost.authenticate('consumer');
  const refreshServer=new McpServer({authenticate:()=>refreshPrincipal,discover:()=>[mcpRefreshToolDefinition()],callTool:()=>({data:{prompt:core.serializeMarkup({kind:'document',children:[core.envelopeToSection(signRefresh(refreshBinding,'1.0.1',1))]},'canonical')}})},()=> 'consumer');
  class RefreshPeer extends PinnedMcpClient {
    async connect(){await this.initialize({name:'psp-cdl-reference',version:'0.1.0'});return this;}
    async request(method,params){return (await refreshServer.handle(JSON.stringify({jsonrpc:'2.0',id:1,method,params}))).result;}
    async notify(method,params){await refreshServer.handle(JSON.stringify({jsonrpc:'2.0',method,params}));}
    async close(){}
  }
  const refreshPeer=await new RefreshPeer().connect();
  const remoteRefresh=new McpPromptRefresher(refreshPeer,{principal:refreshPrincipal,sessionId:refreshSession.sessionId,approvedCatalogDigest:refreshPeer.catalogDigest,now:()=>1,cancelled:()=>false});
  refreshHost.refresh=(p,b,r)=>{refreshBinding=b;return remoteRefresh.refresh(p,b,r);};
  const refreshing=new RefreshingLlmLoop(refreshStore,refreshGate,refreshHost,{id:'mock',revision:'1',sources:[],complete:true,invoke:r=>({type:'final',text:r.messages[0].content})},{postCompletion:'lockdown'});
  for(let turn=1;turn<=2;turn++)assert.equal((await refreshing.run('consumer',refreshSession.sessionId,{message:'next'},{...controls,requestId:'refresh-'+turn,expectedVersion:turn})).text,'System '+(turn===1?'1.0.0':'1.0.1'));
  const refreshState=await refreshStore.execute(actor,{action:'getPromptState',sessionId:refreshSession.sessionId});
  assert.equal(refreshState.state.turnCount,1);assert.equal(refreshState.state.refreshCount,1);
  gate.replaceRegistry('r1','r2',[]);assert.equal(gate.registryRevision,'r2');
} finally {backend.close();}
const source='${psp type=context}hello 🧪${/psp}';
const document=core.documentFromJson(core.documentToJson(core.parseMarkup(source)));
assert.equal(core.serializeMarkup(document),source);
const key=new Uint8Array(32).fill(42); // Public synthetic smoke-test key.
const e=crypto.signDocument(document,{algorithm:'hmac-sha256',signatureVersion:'2.0',secretId:'test',timestamp:1,expires:2,version:'1.0.0',sectionType:'context'},key);
assert(crypto.verifySignature(e,key));
assert.equal(core.serializeMarkup(core.envelopeToDocument(e)),source);
assert.equal(cdl.evaluatePolicy({classes:[],covenants:['no-training'],capabilities:['used-for-model-training'],checks:{},parameters:{},context:{}}).decision,'deny');
assert.equal(cdl.policyTable().rules.length,88);
assert.equal(typeof harness.profileReport,'function');
'''
(CONSUMER / 'smoke.mjs').write_text(node_source, encoding='utf-8')
(CONSUMER / 'peer.mjs').write_text('''
import {McpServer} from '@psp-cdl/mcp-server';
import {serveStdio} from '@psp-cdl/mcp-server/stdio';
const schema={type:'object',properties:{message:{type:'string'}},required:['message'],additionalProperties:false};
await serveStdio(new McpServer({authenticate:()=>({tenantId:'test',subjectId:'test',scopes:[]}),discover:()=>[{name:'read',inputSchema:schema,outputSchema:schema}],callTool:(_n,a)=>({data:a})},()=> 'synthetic'));
''',encoding='utf-8')
run(['node', 'smoke.mjs'], CONSUMER)
run([UV, 'pip', 'install', '--python', sys.executable, '--target', str(PYTHON), *[str(p) for p in ARTIFACTS.glob('*.whl')]])
python_source = '''
import sys
from pathlib import Path
target=Path(sys.argv[1]).resolve()
sys.path.insert(0,str(target))
import psp_cdl_core as core
from psp_cdl_core import crypto
import psp_cdl_cdl as cdl
import psp_cdl_test_harness as harness
import psp_cdl_api_server as api
import psp_cdl_mcp_server as mcp
import psp_cdl_mcpproxy as proxy
import psp_cdl_llmproxy as llm
from psp_cdl_mcpproxy.mcp import PinnedMcpClient, StdioMcpClient, create_mcp_proxy, HttpMcpClient, McpHttpServer, create_mcp_proxy_service
assert callable(HttpMcpClient.connect)
from psp_cdl_api_server.http import create_wsgi_app
from psp_cdl_mcp_server.revision import RevisionedToolRegistry, revision_digest
from psp_cdl_mcp_server.stdio import serve_stdio
from psp_cdl_api_server.persistence import WorkflowStore, OwnerCoordinator
from psp_cdl_api_server.sqlite import SqliteBackend
from psp_cdl_api_server.workflow import WorkflowService
from psp_cdl_api_server.operations import SessionOperations
assert callable(WorkflowService) and callable(SessionOperations)
for module in (core,crypto,cdl,harness,api,mcp,proxy,llm):
    assert Path(module.__file__).resolve().is_relative_to(target), module.__file__
source='${psp type=context}hello 🧪${/psp}'
document=core.document_from_json(core.document_to_json(core.parse_markup(source)))
assert core.serialize_markup(document)==source
key=bytes([42])*32
e=crypto.sign_document(document,{'algorithm':'hmac-sha256','signatureVersion':'2.0','secretId':'test','timestamp':1,'expires':2,'version':'1.0.0','sectionType':'context'},key)
assert crypto.verify_signature(e,key)
assert core.serialize_markup(core.envelope_to_document(e))==source
assert cdl.evaluate_policy({'classes':[],'covenants':['no-training'],'capabilities':['used-for-model-training'],'checks':{},'parameters':{},'context':{}})['decision']=='deny'
assert len(cdl.policy_table()['rules'])==88
assert callable(harness.profile_report)
class Host:
    def authenticate(self,token): return None
    def resolve(self,*args): raise AssertionError('must not resolve')
    def now(self): return 1
service=api.SecurityService(Host())
assert mcp.McpServer(service,lambda:'invalid').handle('{"jsonrpc":"2.0","id":1,"method":"ping"}')['error']['message']=='UNAUTHENTICATED'
assert callable(create_wsgi_app(service)) and callable(serve_stdio)
backend=SqliteBackend(str(Path('python-consumer.sqlite').resolve()),'package-test',lambda:1)
try:
    store=WorkflowStore(backend,resume_secret=bytes([42])*32,authorize_persistence=lambda *_:True,coordinator=OwnerCoordinator(),durable_turns=True)  # Synthetic data only.
    actor={'tenantId':'synthetic-tenant','subjectId':'synthetic-subject'}
    store.execute(actor,{'action':'putNode','nodeId':'entry','nodeVersion':'1','definition':{'text':'🧪','agents':'mcp://echo/read'}})
    session=store.execute(actor,{'action':'createSession','requestId':'create','nodeId':'entry','nodeVersion':'1','policyVersion':'p1','expiresAt':10,'state':{'text':'🧪'}})
    assert store.execute(actor,{'action':'getSession','sessionId':session['sessionId']})==session
    schema={'type':'object','properties':{'message':{'type':'string'}},'required':['message'],'additionalProperties':False}
    class DispatchHost:
        calls=0
        def authenticate(self,t): return {**actor,'scopes':['tools:call','tools:list','models:invoke','sessions:read','sessions:write']} if t=='consumer' else None
        def now(self): return 1
        def snapshot(self,*_): return {'revision':'a1','policyVersion':'p1','registryRevision':'r1','expires':9,'releaseSources':[],'releaseComplete':True}
        def policy(self,p,b,*_): return {'bindingDigest':proxy.binding_digest(b),'resources':[{'classes':[],'covenants':[],'capabilities':[],'checks':{},'parameters':{},'context':{}}]}
        def invoke(self,a,_):
            self.calls+=1
            return a
    host=DispatchHost()
    gate=proxy.McpDispatchGate(store,host,'r1',[{'server':'echo','name':'read','revision':'1','readOnly':True,'sources':[],'complete':True,'inputSchema':schema,'outputSchema':schema,'invoke':host.invoke}])
    output=gate.call_tool('consumer',session['sessionId'],{'name':'echo.read','arguments':{'message':'🧪'}},{'deadline':9,'cancelled':lambda:False})
    assert host.calls==1 and output['data']['message']=='🧪' and output['provenance']['trustLevel']==5
    class LoopHost(DispatchHost):
        def snapshot(self,*_): return {**super().snapshot(),'providerId':'mock','providerRevision':'1'}
        def prompt(self,p,b): return crypto.sign_envelope('Synthetic system text',{'algorithm':'hmac-sha256','signatureVersion':'2.0','secretId':'test','timestamp':0,'expires':9,'version':'1.0.0','sectionType':'system','contentType':'text','attributes':llm.prompt_context(b)},bytes([19])*32)
        def verification(self,*_): return {'keys':[{'id':'test','algorithm':'hmac-sha256','material':bytes([19])*32,'status':'active','trustLevels':[2],'sectionTypes':['system'],'scope':{},'allowUnscoped':False}]}
        def authorize_final(self,*_): return True
    inference=[]
    def model(request,_):
        inference.append(request)
        assert request['messages'][0]['content']=='Synthetic system text'
        return {'type':'tool','name':'echo.read','arguments':{'message':'installed-loop'}} if len(inference)==1 else {'type':'final','text':request['messages'][-1]['data']['message']}
    loop=llm.BufferedLlmLoop(store,gate,LoopHost(),{'id':'mock','revision':'1','sources':[],'complete':True,'invoke':model})
    answer=loop.run('consumer',session['sessionId'],{'message':'read'},{'deadline':9,'cancelled':lambda:False,'maxSteps':3})
    assert answer['text']=='installed-loop' and len(inference)==2 and host.calls==2
    peer=StdioMcpClient.connect({'executable':sys.executable,'args':['-I',str(Path('peer.py').resolve()),str(target)],'env':{},'serverInfo':{'name':'psp-cdl-reference','version':'0.1.0'},'timeoutMs':2000})
    try:
        remote=proxy.McpDispatchGate(store,host,'r1',peer.registrations('echo',[{'name':'read','revision':'1','readOnly':True,'sources':[],'complete':True,'inputSchema':schema,'outputSchema':schema}],lambda:1))
        server=create_mcp_proxy(remote,lambda:'consumer',session['sessionId'],lambda:{'deadline':9,'cancelled':lambda:False})
        server.handle('{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"consumer","version":"1"}}}')
        server.handle('{"jsonrpc":"2.0","method":"notifications/initialized"}')
        response=server.handle('{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"echo.read","arguments":{"message":"installed"}}}')
        assert response['result']['structuredContent']['message']=='installed' and response['result']['_meta']['psp-cdl/provenance']['trustLevel']==5
    finally:
        peer.close()
    import json
    from types import SimpleNamespace
    http=McpHttpServer(SimpleNamespace(authenticate=lambda t,r:host.authenticate(t),open=lambda p,c:{'service':create_mcp_proxy_service(gate,session['sessionId'],lambda:{'deadline':9,'cancelled':c}),'close':lambda:None}),{'endpoint':'http://127.0.0.1:8123/mcp','allowLoopbackHttp':True,'authorizationServers':['https://issuer.example/'],'maxSessions':2,'sessionTtlMs':10000,'callTimeoutMs':2000})
    def send(message,sid=None): return http.handle({'method':'POST','path':'/mcp','headers':[['host','127.0.0.1:8123'],['authorization','Bearer consumer'],['content-type','application/json'],['accept','application/json, text/event-stream'],*([['mcp-session-id',sid]] if sid else [])],'body':json.dumps(message).encode()})
    sid=send({'jsonrpc':'2.0','id':1,'method':'initialize','params':{'protocolVersion':'2025-11-25','capabilities':{},'clientInfo':{'name':'installed','version':'1'}}})['headers']['mcp-session-id']
    send({'jsonrpc':'2.0','method':'notifications/initialized'},sid)
    result=json.loads(send({'jsonrpc':'2.0','id':2,'method':'tools/call','params':{'name':'echo.read','arguments':{'message':'installed-http'}}},sid)['body'])
    assert result['result']['structuredContent']['message']=='installed-http'
    http.close()
    p={**actor,'scopes':['tools:list','tools:call']}
    revisions=RevisionedToolRegistry(SimpleNamespace(authenticate=lambda _:p,authorize=lambda *_:True),[{'name':'read','revision':'1','readOnly':True,'inputSchema':schema,'outputSchema':schema,'invoke':lambda a,_:a}])
    pre={**revisions.revision,'toolRevision':'1','inputDigest':revision_digest({'message':'installed-revision'})}
    assert revisions.service().revisions.call_tool('read',{'message':'installed-revision'},'synthetic',p,pre)['data']['message']=='installed-revision'
    class DurableHost(LoopHost):
        def plan_turn(self,*_): return {'state':{'done':True},'retained':{},'complete':True}
        def authorize_transition(self,*_): return True
        def audit(self,*_): return True
        def authorize_recovery(self,*_): return True
        recovery_policy=DispatchHost.policy
    durable=llm.DurableLlmLoop(store,gate,DurableHost(),{'id':'mock','revision':'1','sources':[],'complete':True,'invoke':lambda *_:{'type':'final','text':'installed-durable'}},{'postCompletion':'lockdown'})
    controls={'deadline':9,'cancelled':lambda:False,'maxSteps':1,'requestId':'durable','expectedVersion':1}
    assert durable.run('consumer',session['sessionId'],{'message':'finish'},controls)['receipt']['status']=='completed'
    assert durable.recover('consumer',session['sessionId'],'durable',controls)['text']=='installed-durable'
    try: durable.run('consumer',session['sessionId'],{'message':'continue'},controls)
    except llm.LockdownError as exc: assert exc.code=='PSP_POST_COMPLETION_LOCKDOWN'
    else: raise AssertionError('completed session accepted input')
    redirect_store=WorkflowStore(backend,resume_secret=bytes([42])*32,authorize_persistence=lambda *_:True,coordinator=OwnerCoordinator(),durable_turns=True,redirect_turns=True)
    redirect_store.execute(actor,{'action':'putNode','nodeId':'support','nodeVersion':'1','definition':{'type':'application'}})
    redirect_session=redirect_store.execute(actor,{'action':'createSession','requestId':'redirect-session','nodeId':'entry','nodeVersion':'1','policyVersion':'p1','expiresAt':10,'state':{}})
    redirect_gate=proxy.McpDispatchGate(redirect_store,host,'r1',[])
    class RedirectHost(DurableHost):
        def resolve_redirect(self,*_):return {'nodeId':'support','nodeVersion':'1','policyVersion':'p1','expiresAt':9}
        redirect_policy=DispatchHost.policy
    redirect_loop=llm.RedirectingLlmLoop(redirect_store,redirect_gate,RedirectHost(),{'id':'mock','revision':'1','sources':[],'complete':True,'invoke':lambda *_:{'type':'final','text':'installed-redirect'}},{'postCompletion':'redirect','target':'mcp://realflow/applications/support'})
    redirected=redirect_loop.run('consumer',redirect_session['sessionId'],{'message':'handoff'},{**controls,'requestId':'redirect'})
    assert redirect_store.execute(actor,{'action':'getSession','sessionId':redirected['redirect']['sessionId']})['state']['input']['text']=='installed-redirect'
    assert redirect_loop.recover('consumer',redirect_session['sessionId'],'redirect',controls)['redirect']==redirected['redirect']
    scoped_store=WorkflowStore(backend,resume_secret=bytes([42])*32,authorize_persistence=lambda *_:True,coordinator=OwnerCoordinator(),durable_turns=True,scoped_turns=True)
    scoped_session=scoped_store.execute(actor,{'action':'createSession','requestId':'scoped-session','nodeId':'entry','nodeVersion':'1','policyVersion':'p1','expiresAt':10,'state':{}})
    scoped_gate=proxy.McpDispatchGate(scoped_store,host,'r1',[]);scoped_requests=[]
    class ScopedHost(DurableHost):
        def application_threat(self,*_):return {'policy':{'id':'application-threat','version':'1'},'state':{'score':7}}
        def scoped_prompt(self,p,b):return crypto.sign_envelope('Installed scoped SYSTEM',{'algorithm':'hmac-sha256','signatureVersion':'2.0','secretId':'test','timestamp':0,'expires':9,'version':'1.0.0','sectionType':'system','contentType':'text','attributes':llm.scoped_prompt_context(b)},bytes([19])*32)
        def scope_boundary(self,p,b,d):return {'bindingDigest':proxy.binding_digest(b),'decision':'allow','threatState':{'score':d['threatState']['score']+1}}
        def plan_scoped_turn(self,p,b,d):return {'retained':d['retained']}
    def scoped_model(r,_):
        scoped_requests.append(r);return {'type':'final','text':r['messages'][0]['content']}
    scoped_loop=llm.ScopedLlmLoop(scoped_store,scoped_gate,ScopedHost(),{'id':'mock','revision':'1','sources':[],'complete':True,'invoke':scoped_model},{'postCompletion':'scoped','scope':{'id':'results','version':'1','system':'Installed scoped SYSTEM','threatPolicy':None}})
    scoped_loop.run('consumer',scoped_session['sessionId'],{'message':'finish'},{**controls,'requestId':'scoped-complete'})
    scoped_answer=scoped_loop.run('consumer',scoped_session['sessionId'],{'message':'explain'},{**controls,'requestId':'scoped-followup','expectedVersion':2})
    assert scoped_answer['text']=='Installed scoped SYSTEM' and scoped_answer['receipt']['status']=='completed'
    assert scoped_requests[1]['messages']==[{'role':'system','content':'Installed scoped SYSTEM'},{'role':'assistant','content':'Synthetic system text'},{'role':'user','content':'explain'}] and scoped_requests[1]['tools']==[]
    scoped_state=scoped_store.execute(actor,{'action':'getSession','sessionId':scoped_session['sessionId']})
    assert scoped_state['version']==3 and scoped_state['llmCompletion']['turnCount']==1 and scoped_state['llmCompletion']['threatState']['score']==9 and scoped_state['state']=={'done':True}
    assert scoped_loop.recover('consumer',scoped_session['sessionId'],'scoped-followup',controls)['text']=='Installed scoped SYSTEM' and len(scoped_requests)==2
    refresh_store=WorkflowStore(backend,resume_secret=bytes([42])*32,authorize_persistence=lambda *_:True,coordinator=OwnerCoordinator(),durable_turns=True,prompt_refresh=True)
    refresh_gate=proxy.McpDispatchGate(refresh_store,host,'r1',[])
    refresh_session=refresh_store.execute(actor,{'action':'createSession','requestId':'refresh-session','nodeId':'entry','nodeVersion':'1','policyVersion':'p1','expiresAt':10,'state':{}})
    def sign_refresh(b,version,timestamp):return crypto.sign_envelope('System '+version,{'algorithm':'hmac-sha256','signatureVersion':'2.0','secretId':'test','timestamp':timestamp,'expires':9,'version':version,'sectionType':'system','contentType':'text','attributes':{**llm.prompt_context(b),'refresh-policy':'interval','refresh-interval':'1','refresh-grace':'0'}},bytes([19])*32)
    class RefreshHost(DurableHost):
        def prompt(self,p,b):return sign_refresh(b,'1.0.0',0)
        def refresh(self,p,b,r):return sign_refresh(b,'1.0.1',1)
        def authorize_refresh(self,*_):return True
        def audit_refresh(self,*_):return True
        def plan_turn(self,*_):return {'state':{},'retained':{},'complete':False}
    refresh_host=RefreshHost();refresh_binding={};refresh_principal=refresh_host.authenticate('consumer')
    class RefreshService:
        def authenticate(self,_):return refresh_principal
        def discover(self,*_):return [llm.mcp_refresh_tool_definition()]
        def call_tool(self,*_):return {'data':{'prompt':core.serialize_markup({'kind':'document','children':[core.envelope_to_section(sign_refresh(refresh_binding,'1.0.1',1))]},'canonical')}}
    refresh_server=mcp.McpServer(RefreshService(),lambda:'consumer')
    class RefreshPeer(PinnedMcpClient):
        def _request(self,method,params,cancelled=lambda:False):return refresh_server.handle(core.canonical_json({'jsonrpc':'2.0','id':1,'method':method,'params':params}))['result']
        def _notify(self,method,params):refresh_server.handle(core.canonical_json({'jsonrpc':'2.0','method':method,'params':params}))
        def close(self):pass
    refresh_peer=RefreshPeer();refresh_peer._initialize({'name':'psp-cdl-reference','version':'0.1.0'})
    remote_refresh=llm.McpPromptRefresher(refresh_peer,{'principal':refresh_principal,'sessionId':refresh_session['sessionId'],'approvedCatalogDigest':refresh_peer.catalog_digest,'now':lambda:1,'cancelled':lambda:False})
    def remote_callback(p,b,r):
        refresh_binding.clear();refresh_binding.update(b);return remote_refresh.refresh(p,b,r)
    refresh_host.refresh=remote_callback
    refreshing=llm.RefreshingLlmLoop(refresh_store,refresh_gate,refresh_host,{'id':'mock','revision':'1','sources':[],'complete':True,'invoke':lambda r,_:{'type':'final','text':r['messages'][0]['content']}},{'postCompletion':'lockdown'})
    for turn in (1,2):assert refreshing.run('consumer',refresh_session['sessionId'],{'message':'next'},{**controls,'requestId':'refresh-'+str(turn),'expectedVersion':turn})['text']=='System '+('1.0.0' if turn==1 else '1.0.1')
    refresh_state=refresh_store.execute(actor,{'action':'getPromptState','sessionId':refresh_session['sessionId']})
    assert refresh_state['state']['turnCount']==1 and refresh_state['state']['refreshCount']==1
    gate.replace_registry('r1','r2',[])
    assert gate.registry_revision=='r2'
finally:
    backend.close()
'''
(CONSUMER / 'peer.py').write_text('''
import sys
from pathlib import Path
sys.path.insert(0,sys.argv[1])
import psp_cdl_mcp_server as mcp
from psp_cdl_mcp_server.stdio import serve_stdio
assert Path(mcp.__file__).resolve().is_relative_to(Path(sys.argv[1]))
schema={'type':'object','properties':{'message':{'type':'string'}},'required':['message'],'additionalProperties':False}
class Tools:
    def authenticate(self,_): return {'tenantId':'test','subjectId':'test','scopes':[]}
    def discover(self,*_): return [{'name':'read','inputSchema':schema,'outputSchema':schema}]
    def call_tool(self,n,a,*_): return {'data':a}
serve_stdio(mcp.McpServer(Tools(),lambda:'synthetic'))
''',encoding='utf-8')
run([sys.executable, '-I', '-c', python_source, str(PYTHON)], CONSUMER)
shutil.copyfile(ROOT/'scripts/package-service-check.mjs', CONSUMER/'service-check.mjs')
run(['node', 'service-check.mjs'], CONSUMER)
service_source="import sys\nsys.path.insert(0,sys.argv[1])\n"+(ROOT/'scripts/package_service_check.py').read_text(encoding='utf-8')
run([sys.executable, '-I', '-c', service_source, str(PYTHON)], CONSUMER)
print('Seven npm tarballs and seven Python wheels passed isolated consumer checks, including buffered/durable/refresh/redirect/scoped loops, recovery/lockdown, stdio/HTTP dispatch, revision leases and registry replacement; no packages published.')
