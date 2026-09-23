// SPDX-License-Identifier: Apache-2.0
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {suite,runHttpCase,httpFixture,request,initialize,call} from '../../../../../scripts/http-fixtures.mjs';
import {parseSse} from '../dist/http.js';
import {readFileSync} from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import {McpHttpServer} from '@psp-cdl/mcp-server/http';
import {HttpMcpClient} from '@psp-cdl/mcpproxy/mcp';
import {config} from '../../../../../scripts/http-fixtures.mjs';
for(const c of suite.cases)test('HTTP '+c.id,async()=>assert.deepEqual(await runHttpCase(c),c.expected));
test('HTTP cancellation is owner-scoped, concurrent, and suppresses late tool output',async()=>{
  const endpoint='http://127.0.0.1:8123/mcp';let started,finish;
  const entered=new Promise(r=>started=r),wait=new Promise(r=>finish=r);
  const f=await httpFixture(endpoint,{onInvoke:async()=>{started();await wait;}});
  try {
    const sid=(await f.adapter.handle(request(endpoint,initialize))).headers['mcp-session-id'];
    await f.adapter.handle(request(endpoint,{jsonrpc:'2.0',method:'notifications/initialized'},sid));
    const pending=f.adapter.handle(request(endpoint,call,sid));await entered;
    assert.equal((await f.adapter.handle(request(endpoint,{...call,id:3},sid))).status,409);
    const cancel=request(endpoint,{jsonrpc:'2.0',method:'notifications/cancelled',params:{requestId:2}},sid);
    const foreign={...cancel,headers:cancel.headers.map(([k,v])=>[k,k==='authorization'?'Bearer test-other':v])};
    assert.equal((await f.adapter.handle(foreign)).status,404);
    assert.equal((await f.adapter.handle(cancel)).status,202);
    finish();const response=await pending;assert.equal(response.status,204);assert.equal(response.body,'');
    assert.equal((await f.f.update()).version,2);
    assert.equal((await f.adapter.handle(request(endpoint,{},sid,{method:'DELETE'}))).status,200);
    assert.equal((await f.adapter.handle(request(endpoint,{...call,id:4},sid))).status,404);
  }finally{finish();f.close();}
});
test('finite SSE is buffered and refuses multiple or incomplete responses',()=>{
  assert.deepEqual(parseSse(': heartbeat\r\nid: a\r\ndata:\r\n\r\nevent: message\r\ndata: {"result":\r\ndata: {}}\r\n\r\n'),{result:{}});
  for(const s of ['data: {}','data: {}\n','data: {}\n\ndata: {}\n\n','event: endpoint\ndata: {}\n\n'])assert.throws(()=>parseSse(s));
});
test('HTTP session quotas, expiry, protected metadata and initialization failures',async()=>{
  const endpoint='http://127.0.0.1:8123/mcp',f=await httpFixture(endpoint,{}, {maxSessions:1,sessionTtlMs:50});
  try{
    const bad=structuredClone(initialize);delete bad.params.clientInfo;
    assert((await f.adapter.handle(request(endpoint,bad))).body.includes('Invalid initialization'));
    assert((await f.adapter.handle(request(endpoint,initialize))).headers['mcp-session-id']);
    assert.equal((await f.adapter.handle(request(endpoint,initialize))).status,503);
    await new Promise(r=>setTimeout(r,70));
    assert((await f.adapter.handle(request(endpoint,initialize))).headers['mcp-session-id']);
    const metadata=await f.adapter.handle(request(endpoint,{},undefined,{method:'GET',path:'/.well-known/oauth-protected-resource/mcp'}));
    assert.equal(JSON.parse(metadata.body).resource,endpoint);
  }finally{f.close();}
});
test('HTTP configuration schema and unsafe endpoints fail before credentials or I/O',async()=>{
  const schema=JSON.parse(readFileSync(new URL('../../../../../schemas/mcp-http.schema.json',import.meta.url),'utf8'));
  const ajv=new Ajv2020().addSchema(schema),server=ajv.compile({$ref:schema.$id+'#/$defs/serverConfig'}),client=ajv.compile({$ref:schema.$id+'#/$defs/peerConfig'});
  assert(server(config('http://127.0.0.1:8123/mcp')));
  const base={endpoint:'https://tools.example/mcp',allowLoopbackHttp:false,serverInfo:{name:'peer',version:'1'},timeoutMs:100};
  assert(client(base));assert(!client({...base,timeoutMs:0}));assert(!client({...base,credential:'secret'}));
  for(const endpoint of ['http://remote.example/mcp','https://user:secret@tools.example/mcp','https://tools.example/mcp?token=secret','https://tools.example/mcp#x'])await assert.rejects(()=>HttpMcpClient.connect({...base,endpoint},()=>{throw Error('must not acquire credentials');}),{code:'INVALID_CONFIGURATION'});
  assert.throws(()=>new McpHttpServer({}, {...config('https://tools.example/mcp'),callTimeoutMs:0}));
});
test('HTTP release reauth and transport deadline suppress completed data',async()=>{
  for(const mode of ['revoke','timeout']) {
    const endpoint='http://127.0.0.1:8123/mcp',f=await httpFixture(endpoint,{}, {callTimeoutMs:100});
    try {
      const sid=(await f.adapter.handle(request(endpoint,initialize))).headers['mcp-session-id'];
      await f.adapter.handle(request(endpoint,{jsonrpc:'2.0',method:'notifications/initialized'},sid));
      f.f.flags.onInvoke=async()=>{if(mode==='revoke')f.f.flags.revoked=true;else await new Promise(r=>setTimeout(r,150));};
      const r=await f.adapter.handle(request(endpoint,call,sid));
      assert.equal(r.status,mode==='revoke'?401:204);assert(!r.body.includes('hello'));
    }finally{f.close();}
  }
});
test('HTTP principal is pinned again at service entry',async()=>{
  const p={tenantId:'tenant',subjectId:'owner',scopes:[]},endpoint='http://127.0.0.1:8123/mcp';
  const adapter=new McpHttpServer({authenticate:()=>p,open:()=>({service:{authenticate:()=>({...p,subjectId:'other'}),discover:()=>{throw Error('must not discover');},callTool:()=>{throw Error('must not call');}},close:()=>{}})},config(endpoint));
  const response=await adapter.handle(request(endpoint,initialize));
  assert.equal(JSON.parse(response.body).error.message,'IDENTITY_CHANGED');assert(!response.headers['mcp-session-id']);adapter.close();
});
