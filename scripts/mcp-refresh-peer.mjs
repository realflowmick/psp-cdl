// SPDX-License-Identifier: Apache-2.0
// Synthetic authenticated peer for actual transport interchange tests.
import {appendFileSync} from 'node:fs';
import {createServer} from 'node:http';
import {McpServer} from '@psp-cdl/mcp-server';
import {serveStdio} from '@psp-cdl/mcp-server/stdio';
import {McpHttpServer,nodeHttpHandler} from '@psp-cdl/mcp-server/http';
import {TestPeer,principal} from './mcp-refresh-fixtures.mjs';
import {config} from './http-fixtures.mjs';
const c=JSON.parse(process.argv[2]),peer=new TestPeer(c.mode),call=peer.service.callTool;
peer.service.callTool=async(...args)=>{appendFileSync(c.spy,'call\n');return call(...args);};
peer.service.authenticate=t=>{if(t!=='synthetic-refresh-token')throw Error('DENIED');return principal;};
if(c.transport==='stdio')await serveStdio(new McpServer(peer.service,()=>process.env.PSP_REFRESH_TOKEN??''));
else{
  let adapter;
  const server=createServer((req,res)=>nodeHttpHandler(adapter)(req,res));
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const endpoint=`http://127.0.0.1:${server.address().port}/mcp`;
  adapter=new McpHttpServer({authenticate:(t,r)=>t==='synthetic-refresh-token'&&r===endpoint?principal:null,open:()=>({service:peer.service,close:()=>{}})},config(endpoint));
  console.log(endpoint);process.stdin.resume();process.stdin.on('end',()=>{adapter.close();server.closeAllConnections();server.close();});
}
