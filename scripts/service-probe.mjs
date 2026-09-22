// SPDX-License-Identifier: Apache-2.0
// Synthetic interoperability subprocess; never a deployment configuration.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {suite,fixture} from './service-fixtures.mjs';
import {handleHttp,createHttpServer} from '@psp-cdl/api-server/http';
import {McpServer} from '@psp-cdl/mcp-server';
import {serveStdio} from '@psp-cdl/mcp-server/stdio';
export const messages=[
  {jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'mixed-language-🧪',version:'1'}}},
  {jsonrpc:'2.0',method:'notifications/initialized',params:{_meta:{}}},
  {jsonrpc:'2.0',id:2,method:'tools/list'},
  {jsonrpc:'2.0',id:3,method:'tools/call',params:{name:'realflow.policy.evaluate',arguments:{operation_id:'op-1'},_meta:{progressToken:'probe-3'}}},
  {jsonrpc:'2.0',id:4,method:'tools/call',params:{name:'realflow.security.verify',arguments:suite.httpCases.find(c=>c.id==='verify-valid').request}}
];
const f=fixture(),server=new McpServer(f.service,f.credential);
if(process.argv[2]==='--stdio') await serveStdio(server);
else if(process.argv[2]==='--http-server') {
  const http=createHttpServer(f.service);http.listen(0,'127.0.0.1',()=>console.log(http.address().port));
  process.stdin.resume();process.stdin.on('end',()=>http.close());
} else if(process.argv[2]==='--http-client') {
  for(const c of suite.httpCases.filter(c=>['policy-deny','verify-valid','no-auth','cross-tenant','forged-checks'].includes(c.id))) {
    const {request}=fixture(c);
    const response=await fetch(process.argv[3]+request.path,{method:request.method,headers:Object.fromEntries(request.headers),body:request.body});
    assert.deepEqual({status:response.status,body:await response.json()},c.expected);
  }
  console.log('Node client passed against Python HTTP server.');
} else {
  const http=[];
  for(const c of suite.httpCases) {const f=fixture(c),r=await handleHttp(f.service,f.request);http.push({id:c.id,status:r.status,body:JSON.parse(r.body)});}
  const mcp=[];for(const message of messages) {const reply=await server.handle(JSON.stringify(message));if(reply!==null)mcp.push(reply);}
  if(process.argv[2]==='--python-stdio') {
    const processResult=spawnSync(process.argv[3],['scripts/service_probe.py','--stdio'],{input:messages.map(JSON.stringify).join('\n')+'\n',encoding:'utf8',timeout:15000});
    assert.equal(processResult.status,0,processResult.stderr);
    assert.deepEqual(processResult.stdout.trim().split('\n').map(JSON.parse),mcp);
    console.log('Node client passed against Python MCP stdio server.');
  } else console.log(JSON.stringify({http,mcp,messages}));
}
