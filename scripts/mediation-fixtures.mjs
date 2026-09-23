// SPDX-License-Identifier: Apache-2.0
import {mkdtempSync,readFileSync,existsSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {fixture,suite as dispatchSuite} from './dispatch-fixtures.mjs';
import {McpDispatchGate} from '@psp-cdl/mcpproxy';
import {StdioMcpClient,createMcpProxy} from '@psp-cdl/mcpproxy/mcp';
import {MCP_VERSION} from '@psp-cdl/mcp-server';
export const suite=JSON.parse(readFileSync(new URL('../conformance/vectors/dispatch/stdio-0.1.json',import.meta.url),'utf8'));
export function messages(c={}) {return [
  {jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:MCP_VERSION,capabilities:{},clientInfo:{name:'test-client',version:'1'}}},
  {jsonrpc:'2.0',method:'notifications/initialized'},
  {jsonrpc:'2.0',id:2,method:'tools/list',params:{}},
  {jsonrpc:'2.0',...(c.notification?{}:{id:3}),method:c.method??'tools/call',params:c.request??{name:'echo.read',arguments:{message:c.largeRequest?'x'.repeat(250000):'hello 🧪'}}}
];}
export function summarize(replies,calls) {
  const r=replies.find(r=>r.id===3), result=r?.result;
  const code=!r?'NO_REPLY':r.error?.message??(result.isError?JSON.parse(result.content[0].text).error.code:'OK');
  return {code,calls,released:code==='OK'?1:0,...(code==='OK'?{result}:{})};
}
export async function mediationFixture(c={},executable=process.execPath,script=fileURLToPath(new URL('./mediation-peer.mjs',import.meta.url)),spy) {
  const f=await fixture(c.settings),directory=spy?null:mkdtempSync(join(tmpdir(),'psp-peer-'));spy??=join(directory,'calls');
  let peer;
  const calls=()=>existsSync(spy)?readFileSync(spy,'utf8').trim().split('\n').length:0;
  const cleanup=async()=>{await peer?.close();f.close();if(directory)rmSync(directory,{recursive:true,force:true});};
  try {
    peer=await StdioMcpClient.connect({executable,args:[script,c.mode??'normal',spy],env:{...(process.env.SystemRoot?{SystemRoot:process.env.SystemRoot}:{}),PSP_TEST_CREDENTIAL:c.downstreamToken??'test-downstream'},serverInfo:{name:'psp-cdl-reference',version:'0.1.0'},timeoutMs:2000});
    const approval={name:'read',revision:'1',readOnly:!c.mutating,sources:[{id:'host-approved-endpoint',capabilities:[]}],complete:true,inputSchema:structuredClone(dispatchSuite.schema),outputSchema:structuredClone(dispatchSuite.schema)};
    if(c.mode==='write-hang')for(const s of [approval.inputSchema,approval.outputSchema])s.properties.message.maxLength=300000;
    if(c.mismatch)approval.inputSchema.properties.message.maxLength=31;
    const registrations=peer.registrations('echo',[approval],()=>f.flags.now);
    const gate=new McpDispatchGate(f.store,f.host,'registry-1',registrations);
    const server=createMcpProxy(gate,()=>c.token??'test-owner',f.session.sessionId,()=>f.options);
    return {f,peer,gate,server,calls,close:cleanup};
  }catch(e){await cleanup();throw e;}
}
export async function runMediationCase(c) {
  let f;
  try {
    f=await mediationFixture(c);const replies=[];
    for(const m of messages(c)){const r=await f.server.handle(JSON.stringify(m));if(r)replies.push(r);}
    return summarize(replies,f.calls());
  }catch(e){return {code:e.code??'UNEXPECTED_ERROR',calls:f?.calls()??0,released:0};}
  finally {await f?.close();}
}
