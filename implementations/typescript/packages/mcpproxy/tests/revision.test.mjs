// SPDX-License-Identifier: Apache-2.0
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import {McpServer,MCP_VERSION} from '@psp-cdl/mcp-server';
import {REVISION_PROFILE,REVISION_KEY,revisionDigest} from '@psp-cdl/mcp-server/revision';
import {McpDispatchGate} from '@psp-cdl/mcpproxy';
import {PinnedMcpClient} from '../dist/peer.js';
import {suite,runRevisionCase,revisionPeer,approval,principal,tool} from '../../../../../scripts/revision-fixtures.mjs';
import {fixture} from '../../../../../scripts/dispatch-fixtures.mjs';
for(const c of suite.cases)test('revision '+c.id,async()=>assert.deepEqual(await runRevisionCase(c),c.expected));
class Client extends PinnedMcpClient {
  id=0;closed=false;
  constructor(server){super();this.server=server;}
  async request(method,params){const r=await this.server.handle(JSON.stringify({jsonrpc:'2.0',id:++this.id,method,params}));if(r.error)throw Object.assign(Error(),{code:r.error.message});return r.result;}
  async notify(method,params){await this.server.handle(JSON.stringify({jsonrpc:'2.0',method,params}));}
  async close(){this.closed=true;}
  async init(){await this.initialize({name:'psp-cdl-reference',version:'0.1.0'},REVISION_PROFILE);return this;}
}
const client=async p=>new Client(new McpServer(p.service(),()=> 'test-downstream')).init();
test('explicit approval and receipt verification; no silent negotiation downgrade',async()=>{
  for(const [mode,code,calls] of [['ok','OK',1],['race','INVALID_TOOL_RESPONSE',0],['drift','DISCOVERY_CHANGED',0],['missing-receipt','INVALID_REVISION_RECEIPT',1],['forged-receipt','INVALID_REVISION_RECEIPT',1],['bad-catalog','INVALID_REVISION_DATA',0],['unsupported','REVISION_UNSUPPORTED',0]]) {
    let count=0,p;
    try {
      p=await client(revisionPeer(mode,()=>count++));
      assert.throws(()=>p.registrations('echo',[approval],()=>1000),{code:'CATALOG_NOT_APPROVED'});
      assert.throws(()=>p.registrations('echo',[{...approval,revision:'other'}],()=>1000,p.catalogDigest),{code:'DISCOVERY_MISMATCH'});
      const snapshot=p.catalogSnapshot;snapshot.tools.length=0;assert.equal(p.catalogSnapshot.tools.length,1);
      const r=p.registrations('echo',[approval],()=>1000,p.catalogSnapshot.approvalDigest)[0];
      const result=await r.invoke({message:'hello'},{deadline:1800,cancelled:()=>false});assert.equal(code,'OK');assert.deepEqual(result,{message:'hello'});
    }catch(e){assert.equal(e.code,code,mode);}
    assert.equal(count,calls,mode);await p?.close();
  }
});
test('fresh approved peer replacement preserves authority, affinity and capability checks',async()=>{
  const f=await fixture();let calls=0;
  const p=await client(revisionPeer('ok',()=>calls++)),next=await client(revisionPeer('ok',()=>calls++,'tool-2'));
  const regs=p.registrations('echo',[approval],()=>1000,p.catalogDigest),candidate=next.registrations('echo',[{...approval,revision:'tool-2'}],()=>1000,next.catalogDigest);
  const gate=new McpDispatchGate(f.store,f.host,'registry-1',regs),call=name=>gate.callTool('test-owner',f.session.sessionId,{name,arguments:{message:'hello'}},f.options);
  try {
    assert.throws(()=>gate.replaceRegistry('wrong','registry-2',candidate),{code:'REVISION_CONFLICT'});
    assert.throws(()=>gate.replaceRegistry('registry-1','registry-2',[{...candidate[0],inputSchema:{type:'string'}}]),{code:'UNSUPPORTED_SCHEMA'});
    assert.equal((await call('echo.read')).provenance.toolRevision,'tool-1');
    gate.replaceRegistry('registry-1','registry-2',candidate);
    await assert.rejects(()=>call('echo.read'),{code:'STALE_AUTHORITY'});assert.equal(calls,1);
    f.flags.registryDrift=true;
    assert.equal((await call('echo.read')).provenance.toolRevision,'tool-2');
    assert.throws(()=>gate.replaceRegistry('registry-2','registry-1',regs),{code:'INVALID_REGISTRY_REVISION'});
    gate.replaceRegistry('registry-2','registry-3',[{...candidate[0],sources:[{id:'host',capabilities:['used-for-model-training']}]}]);
    const original=f.host.snapshot;f.host.snapshot=()=>({...original(),registryRevision:gate.registryRevision});
    await assert.rejects(()=>call('echo.read'),{code:'POLICY_DENIED'});assert.equal(calls,2);
    gate.replaceRegistry('registry-3','registry-4',[{...candidate[0],server:'unapproved'}]);
    await assert.rejects(()=>call('unapproved.read'),{code:'TOOL_NOT_ALLOWED'});
    await assert.rejects(()=>call('echo.read'),{code:'TOOL_NOT_ALLOWED'});
  }finally{await p.close();await next.close();f.close();}
});
test('gate is busy before authentication and throughout invocation and release',async()=>{
  const f=await fixture();let enter,finish;
  const entered=new Promise(r=>enter=r),wait=new Promise(r=>finish=r),original=f.host.authenticate;
  f.host.authenticate=async t=>{enter();await wait;return original(t);};
  try {
    const pending=f.gate.listTools('test-other',f.session.sessionId,f.options);await entered;
    assert.throws(()=>f.gate.replaceRegistry('registry-1','registry-2',[]),{code:'REGISTRY_BUSY'});
    finish();await assert.rejects(()=>pending);
    f.host.authenticate=original;
    const deny=()=>assert.throws(()=>f.gate.replaceRegistry('registry-1','registry-2',[]),{code:'REGISTRY_BUSY'});
    f.flags.onInvoke=deny;const policy=f.host.policy;f.host.policy=async(...a)=>{deny();return policy(...a);};
    await f.gate.callTool('test-owner',f.session.sessionId,{name:'echo.read',arguments:{message:'hello'}},f.options);
    f.gate.replaceRegistry('registry-1','registry-2',[]);assert.equal(f.gate.registryRevision,'registry-2');
  }finally{finish();f.close();}
});
test('server refuses unnegotiated preconditions and request-local downgrade',async()=>{
  const p=revisionPeer(),service=p.service(),s=new McpServer(service,()=> 'test-downstream');
  const send=(id,method,params,context)=>s.handle(JSON.stringify({jsonrpc:'2.0',...(id?{id}:{}),method,params}),context);
  const init={protocolVersion:MCP_VERSION,clientInfo:{name:'test',version:'1'},capabilities:{experimental:{[REVISION_KEY]:{profile:REVISION_PROFILE}}}};
  await send(1,'initialize',init);await send(null,'notifications/initialized',{});
  const downgraded={...service};delete downgraded.revisions;
  assert.equal((await send(2,'tools/list',{}, {token:'test-downstream',service:downgraded})).error.message,'REVISION_UNSUPPORTED');
  const legacy=new McpServer({authenticate:()=>principal,discover:()=>[],callTool:()=>{throw Error('must not invoke');}},()=> 'test-downstream');
  await legacy.handle(JSON.stringify({jsonrpc:'2.0',id:1,method:'initialize',params:{...init,capabilities:{}}}));
  await legacy.handle(JSON.stringify({jsonrpc:'2.0',method:'notifications/initialized'}));
  const result=await legacy.handle(JSON.stringify({jsonrpc:'2.0',id:2,method:'tools/call',params:{name:'read',arguments:{},_meta:{[REVISION_KEY]:{}}}}));
  assert.equal(JSON.parse(result.result.content[0].text).error.code,'REVISION_UNSUPPORTED');
});
test('published schemas accept actual descriptors and reject extra precondition authority',()=>{
  const s=JSON.parse(readFileSync(new URL('../../../../../schemas/mcp-revision.schema.json',import.meta.url),'utf8')),ajv=new Ajv2020().addSchema(s),catalog=ajv.compile({$ref:s.$id+'#/$defs/catalog'}),pre=ajv.compile({$ref:s.$id+'#/$defs/precondition'});
  const r=revisionPeer().registry.revision,p={...r,toolRevision:'tool-1',inputDigest:revisionDigest({})};
  assert(catalog(r));assert(pre(p));assert(!pre({...p,tenantId:'forged'}));assert(!catalog({...r,generation:0}));
});
