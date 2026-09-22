// SPDX-License-Identifier: Apache-2.0
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Readable,Writable} from 'node:stream';
import {McpServer} from '../dist/index.js';
import {serveStdio} from '../dist/stdio.js';
import {fixture,suite} from '../../../../../scripts/service-fixtures.mjs';
const initialize={jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'test',version:'1'}}};
const initialized={jsonrpc:'2.0',method:'notifications/initialized'};
const list={jsonrpc:'2.0',id:2,method:'tools/list'};
const call={jsonrpc:'2.0',id:3,method:'tools/call',params:{name:'realflow.policy.evaluate',arguments:{operation_id:'op-1'}}};
const send=(server,message)=>server.handle(JSON.stringify(message));
test('MCP lifecycle, discovery, authentication and scoped calls',async()=>{
  const f=fixture(),server=new McpServer(f.service,f.credential);
  assert.equal((await send(server,call)).error.message,'NOT_INITIALIZED');assert.equal(f.resolutions(),0);
  assert.equal((await send(server,initialize)).result.protocolVersion,'2025-11-25');
  assert.equal((await send(server,list)).error.message,'NOT_INITIALIZED');
  assert.equal(await send(server,initialized),null);
  const tools=(await send(server,list)).result.tools;assert.equal(tools.length,2);
  tools[0].name='mutated';assert.equal((await send(server,list)).result.tools[0].name,'realflow.security.verify');
  const result=(await send(server,call)).result;assert.deepEqual(JSON.parse(result.content[0].text),result.structuredContent);assert.equal(result.structuredContent.decision,'deny');
  assert.equal((await send(server,{...call,params:{name:'realflow.security.decrypt',arguments:{}}})).error.code,-32602);
  assert.equal(await send(server,{jsonrpc:'2.0',method:'tools/call',params:call.params}),null);assert.equal(f.resolutions(),1);
  f.setToken('invalid');assert.equal((await send(server,call)).error.message,'UNAUTHENTICATED');assert.equal(f.resolutions(),1);
  f.setToken('public-tenant-b');assert.equal((await send(server,call)).error.message,'IDENTITY_CHANGED');
});
test('MCP cannot accept caller-supplied evidence or malformed JSON-RPC',async()=>{
  const f=fixture(),server=new McpServer(f.service,f.credential);await send(server,initialize);await send(server,initialized);
  assert.equal((await send(server,{...call,params:{...call.params,arguments:{operation_id:'op-1',checks:{trusted:true}}}})).error.code,-32602);
  assert.equal((await server.handle('{"jsonrpc":"2.0","id":1,"id":2,"method":"ping"}')).error.code,-32700);
  for(const message of [[],{jsonrpc:'2.0',id:null,method:'ping'}]) assert.equal((await send(server,message)).error.code,-32600);
  assert.equal((await send(server,{...list,params:null})).error.code,-32602);assert.equal(f.resolutions(),0);
});
test('stdio framing handles fragmented UTF-8, notifications, and truncated data',async()=>{
  const f=fixture(),server=new McpServer(f.service,f.credential);let output='';
  const input=Buffer.from([initialize,initialized,list,call].map(JSON.stringify).join('\n')+'\n');
  await serveStdio(server,Readable.from([...input].map(byte=>Buffer.from([byte]))),new Writable({write(chunk,_encoding,done){output+=chunk.toString();done();}}));
  const replies=output.trim().split('\n').map(JSON.parse);assert.equal(replies.length,3);assert.equal(replies[2].result.structuredContent.decision,'deny');
  await assert.rejects(()=>serveStdio(server,Readable.from([Buffer.from('{}')]),new Writable({write(_c,_e,d){d();}})),/TRUNCATED_FRAME/);
});
test('verification tool uses the same signed markup codec as HTTP',async()=>{
  const f=fixture(),server=new McpServer(f.service,f.credential);await send(server,initialize);await send(server,initialized);
  const request=suite.httpCases.find(c=>c.id==='verify-valid').request;
  assert.equal((await send(server,{...call,params:{name:'realflow.security.verify',arguments:request}})).result.structuredContent.summary.valid,1);
});
test('MCP metadata cannot elevate scope or change discovery',async()=>{
  const f=fixture();f.setToken('public-no-scope');const server=new McpServer(f.service,f.credential);
  await send(server,initialize);await send(server,{...initialized,params:{_meta:{}}});
  const _meta={scopes:['policy:evaluate'],tenantId:'tenant-a',progressToken:123};
  assert.deepEqual((await send(server,{...list,params:{_meta}})).result.tools,[]);
  const result=(await send(server,{...call,params:{...call.params,_meta}})).result;
  assert.equal(result.isError,true);assert.equal(JSON.parse(result.content[0].text).error.code,'FORBIDDEN');assert.equal(f.resolutions(),0);
});
