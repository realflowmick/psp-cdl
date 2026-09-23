// SPDX-License-Identifier: Apache-2.0
// Synthetic process fixture; its credentials and publication hooks are not an application API.
import {createServer} from 'node:http';
import {appendFileSync} from 'node:fs';
import {McpServer} from '@psp-cdl/mcp-server';
import {serveStdio} from '@psp-cdl/mcp-server/stdio';
import {McpHttpServer,nodeHttpHandler} from '@psp-cdl/mcp-server/http';
import {revisionPeer,principal} from './revision-fixtures.mjs';
import {config} from './http-fixtures.mjs';
const c=JSON.parse(process.argv[2]),p=revisionPeer(c.mode,()=>appendFileSync(c.spy,'call\n'),c.revision??'tool-1');
if(c.transport==='stdio')await serveStdio(new McpServer(p.service(),()=> 'test-downstream'));
else {
  let adapter;
  const server=createServer((req,res)=>nodeHttpHandler(adapter)(req,res));
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const endpoint=`http://127.0.0.1:${server.address().port}/mcp`;
  adapter=new McpHttpServer({authenticate:(t,r)=>t==='test-downstream'&&r===endpoint?principal:null,open:(_p,cancelled)=>({service:p.service(cancelled),close:()=>{}})},config(endpoint));
  console.log(endpoint);process.stdin.resume();
  process.stdin.on('end',()=>{adapter.close();server.closeAllConnections();server.close();});
}
