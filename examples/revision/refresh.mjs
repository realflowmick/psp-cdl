// SPDX-License-Identifier: Apache-2.0
import {fileURLToPath} from 'node:url';
import {McpServer} from '@psp-cdl/mcp-server';
import {serveStdio} from '@psp-cdl/mcp-server/stdio';
import {RevisionedToolRegistry,REVISION_PROFILE} from '@psp-cdl/mcp-server/revision';
import {StdioMcpClient} from '@psp-cdl/mcpproxy/mcp';
import {McpDispatchGate} from '@psp-cdl/mcpproxy';
import {fixture} from '../../scripts/dispatch-fixtures.mjs';
import {approval,principal,tool} from '../../scripts/revision-fixtures.mjs';
if(process.argv[2]==='peer') {
  const registry=new RevisionedToolRegistry({authenticate:t=>t==='synthetic'?principal:null,authorize:()=>true},[tool(a=>a)]);
  if(process.argv[3]==='tool-2')registry.publish(registry.revision,[tool(a=>a,'tool-2')]);
  await serveStdio(new McpServer(registry.service(),()=> 'synthetic'));
}else {
  const f=await fixture();let old,next;
  const connect=revision=>StdioMcpClient.connect({executable:process.execPath,args:[fileURLToPath(import.meta.url),'peer',revision],env:{},serverInfo:{name:'psp-cdl-reference',version:'0.1.0'},timeoutMs:3000,revisionProfile:REVISION_PROFILE});
  try {
    old=await connect('tool-1');
    const gate=new McpDispatchGate(f.store,f.host,'registry-1',old.registrations('echo',[approval],()=>1000,old.catalogSnapshot.approvalDigest));
    const call=async()=>{const r=await gate.callTool('test-owner',f.session.sessionId,{name:'echo.read',arguments:{message:'hello'}},f.options);console.log(r.provenance.toolRevision+' / '+r.provenance.registryRevision);};
    await call();next=await connect('tool-2');
    const candidate=next.registrations('echo',[{...approval,revision:'tool-2'}],()=>1000,next.catalogSnapshot.approvalDigest);
    gate.replaceRegistry('registry-1','registry-2',candidate);
    f.flags.registryDrift=true; // Publish matching host authority only after replacement.
    await old.close();await call();
  }finally{await old?.close();await next?.close();f.close();}
}
