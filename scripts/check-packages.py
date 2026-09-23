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

components = ('core', 'cdl', 'test-harness', 'api-server', 'mcp-server', 'mcpproxy')
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
import {StdioMcpClient,createMcpProxy,HttpMcpClient,McpHttpServer,createMcpProxyService} from '@psp-cdl/mcpproxy/mcp';
assert.equal(typeof HttpMcpClient.connect,'function');
import {SqliteBackend} from '@psp-cdl/api-server/sqlite';
import {WorkflowService} from '@psp-cdl/api-server/workflow';
import {SessionOperations} from '@psp-cdl/api-server/operations';
assert.equal(typeof WorkflowService,'function');assert.equal(typeof SessionOperations,'function');
for(const pkg of ['core','cdl','test-harness','api-server','mcp-server','mcpproxy']) assert(fileURLToPath(import.meta.resolve('@psp-cdl/'+pkg)).startsWith(resolve('node_modules')+sep));
const service=new SecurityService({authenticate:()=>null,resolve:()=>{throw new Error('must not resolve');},now:()=>1});
await assert.rejects(()=>service.invoke('evaluate',{operation_id:'op'},'invalid'),{code:'UNAUTHENTICATED'});
assert.equal((await new McpServer(service,()=> 'invalid').handle('{"jsonrpc":"2.0","id":1,"method":"ping"}')).error.message,'UNAUTHENTICATED');
assert.equal(typeof createHttpServer,'function');assert.equal(typeof serveStdio,'function');
const backend=new SqliteBackend(resolve('consumer.sqlite'),'package-test',()=>1);
try {
  const store=new WorkflowStore(backend,{resumeSecret:new Uint8Array(32).fill(42),authorizePersistence:()=>true,coordinator:new OwnerCoordinator()}); // Synthetic data only.
  const actor={tenantId:'synthetic-tenant',subjectId:'synthetic-subject'};
  await store.execute(actor,{action:'putNode',nodeId:'entry',nodeVersion:'1',definition:{text:'🧪',agents:'mcp://echo/read'}});
  const session=await store.execute(actor,{action:'createSession',requestId:'create',nodeId:'entry',nodeVersion:'1',policyVersion:'p1',expiresAt:10,state:{text:'🧪'}});
  assert.deepEqual(await store.execute(actor,{action:'getSession',sessionId:session.sessionId}),session);
  const schema={type:'object',properties:{message:{type:'string'}},required:['message'],additionalProperties:false};
  let calls=0;
  const host={authenticate:t=>t==='consumer'?{...actor,scopes:['tools:call']}:null,now:()=>1,
    snapshot:()=>({revision:'a1',policyVersion:'p1',registryRevision:'r1',expires:9,releaseSources:[],releaseComplete:true}),
    policy:(_p,b)=>({bindingDigest:bindingDigest(b),resources:[{classes:[],covenants:[],capabilities:[],checks:{},parameters:{},context:{}}]})};
  const gate=new McpDispatchGate(store,host,'r1',[{server:'echo',name:'read',revision:'1',readOnly:true,sources:[],complete:true,inputSchema:schema,outputSchema:schema,invoke:a=>{calls++;return a;}}]);
  const output=await gate.callTool('consumer',session.sessionId,{name:'echo.read',arguments:{message:'🧪'}},{deadline:9,cancelled:()=>false});
  assert.equal(calls,1);assert.equal(output.data.message,'🧪');assert.equal(output.provenance.trustLevel,5);
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
from psp_cdl_mcpproxy.mcp import StdioMcpClient, create_mcp_proxy, HttpMcpClient, McpHttpServer, create_mcp_proxy_service
assert callable(HttpMcpClient.connect)
from psp_cdl_api_server.http import create_wsgi_app
from psp_cdl_mcp_server.revision import RevisionedToolRegistry, revision_digest
from psp_cdl_mcp_server.stdio import serve_stdio
from psp_cdl_api_server.persistence import WorkflowStore, OwnerCoordinator
from psp_cdl_api_server.sqlite import SqliteBackend
from psp_cdl_api_server.workflow import WorkflowService
from psp_cdl_api_server.operations import SessionOperations
assert callable(WorkflowService) and callable(SessionOperations)
for module in (core,crypto,cdl,harness,api,mcp,proxy):
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
    store=WorkflowStore(backend,resume_secret=bytes([42])*32,authorize_persistence=lambda *_:True,coordinator=OwnerCoordinator())  # Synthetic data only.
    actor={'tenantId':'synthetic-tenant','subjectId':'synthetic-subject'}
    store.execute(actor,{'action':'putNode','nodeId':'entry','nodeVersion':'1','definition':{'text':'🧪','agents':'mcp://echo/read'}})
    session=store.execute(actor,{'action':'createSession','requestId':'create','nodeId':'entry','nodeVersion':'1','policyVersion':'p1','expiresAt':10,'state':{'text':'🧪'}})
    assert store.execute(actor,{'action':'getSession','sessionId':session['sessionId']})==session
    schema={'type':'object','properties':{'message':{'type':'string'}},'required':['message'],'additionalProperties':False}
    class DispatchHost:
        calls=0
        def authenticate(self,t): return {**actor,'scopes':['tools:call']} if t=='consumer' else None
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
print('Six npm tarballs and six Python wheels passed isolated consumer checks, including stdio/HTTP dispatch, revision leases and registry replacement; no packages published.')
