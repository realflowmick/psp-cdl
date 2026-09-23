// SPDX-License-Identifier: Apache-2.0
// Synthetic HTTP authorities, SQLite sessions and tool spies, for tests/examples only.
import {readFileSync} from 'node:fs';
import {fixture,suite as gateSuite} from './dispatch-fixtures.mjs';
import {McpHttpServer} from '@psp-cdl/mcp-server/http';
import {createMcpProxyService} from '@psp-cdl/mcpproxy/mcp';
export const suite=JSON.parse(readFileSync(new URL('../conformance/vectors/dispatch/http-0.1.json',import.meta.url),'utf8'));
export const config=endpoint=>({endpoint,allowLoopbackHttp:true,authorizationServers:['https://issuer.example/'],maxSessions:8,sessionTtlMs:60000,callTimeoutMs:2000});
export const initialize={jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'fixture',version:'1'}}};
export const call={jsonrpc:'2.0',id:2,method:'tools/call',params:{name:'echo.read',arguments:{message:'hello 🧪'}}};
export const approval={name:'read',revision:'tool-1',readOnly:true,complete:true,sources:[],inputSchema:gateSuite.schema,outputSchema:gateSuite.schema};
export function request(endpoint,message,sid,extra={}) {
  return {method:'POST',path:'/mcp',headers:[['host',new URL(endpoint).host],['authorization','Bearer test-owner'],['content-type','application/json'],['accept','application/json, text/event-stream'],['mcp-protocol-version','2025-11-25'],...(sid?[['mcp-session-id',sid]]:[])],body:Buffer.from(JSON.stringify(message)),...extra};
}
export async function httpFixture(endpoint='http://127.0.0.1:8123/mcp',settings={},overrides={}) {
  const f=await fixture(settings);
  const adapter=new McpHttpServer({authenticate:(t,resource)=>resource===endpoint?f.host.authenticate(t):null,open:(_p,cancelled)=>({service:createMcpProxyService(f.gate,f.session.sessionId,()=>({...f.options,cancelled:()=>cancelled()||f.options.cancelled()})),close:()=>{}})}, {...config(endpoint),...overrides});
  return {f,adapter,close:()=>{adapter.close();f.close();}};
}
export async function runHttpCase(c) {
  const endpoint='http://127.0.0.1:8123/mcp',f=await httpFixture(endpoint,c.settings);
  try {
    const init=await f.adapter.handle(request(endpoint,initialize));
    const sid=init.headers['mcp-session-id'];
    await f.adapter.handle(request(endpoint,{jsonrpc:'2.0',method:'notifications/initialized'},sid));
    const r=request(endpoint,c.message??call,c.missingSession?undefined:sid,c.http??{});
    for(const [name,value] of Object.entries(c.headers??{})) {r.headers=r.headers.filter(([k])=>k!==name);if(value!==null)r.headers.push([name,value]);}
    if(c.duplicate)r.headers.push(['Authorization','Bearer test-owner']);
    if(c.raw!==undefined)r.body=Buffer.from(c.raw);
    if(c.oversize)r.body=Buffer.alloc(1_048_577,32);
    const response=await f.adapter.handle(r),body=response.body?JSON.parse(response.body):{};
    return {status:response.status,code:body.error?.code??(body.result?.isError?JSON.parse(body.result.content[0].text).error.code:body.error?.message??'OK'),calls:f.f.stats().calls,released:body.result?.structuredContent?1:0};
  }finally{f.close();}
}
