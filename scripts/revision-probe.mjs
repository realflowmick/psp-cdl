// SPDX-License-Identifier: Apache-2.0
import {HttpMcpClient,StdioMcpClient} from '@psp-cdl/mcpproxy/mcp';
import {McpDispatchGate} from '@psp-cdl/mcpproxy';
import {fixture} from './dispatch-fixtures.mjs';
import {approval} from './revision-fixtures.mjs';
const c=JSON.parse(process.argv[2]);let p,n,f;
const connect=cfg=>c.transport==='http'?HttpMcpClient.connect(cfg,()=> 'test-downstream'):StdioMcpClient.connect(cfg);
try {
  p=await connect(c.config);f=await fixture();
  const regs=p.registrations('echo',[approval],()=>1000,c.unapproved?'wrong':p.catalogSnapshot.approvalDigest);
  const gate=new McpDispatchGate(f.store,f.host,'registry-1',regs),call=()=>gate.callTool('test-owner',f.session.sessionId,{name:'echo.read',arguments:{message:'hello 🧪'}},f.options);
  let result=await call();
  if(c.nextConfig){
    n=await connect(c.nextConfig);
    const next=n.registrations('echo',[{...approval,revision:'tool-2'}],()=>1000,n.catalogSnapshot.approvalDigest);
    gate.replaceRegistry('registry-1','registry-2',next);f.flags.registryDrift=true;await p.close();
    result=await call();
  }
  console.log(JSON.stringify({code:'OK',released:1,data:result.data,toolRevision:result.provenance.toolRevision,registryRevision:result.provenance.registryRevision}));
}catch(e){console.log(JSON.stringify({code:e.code??'UNEXPECTED_ERROR',released:0}));}
finally{await p?.close();await n?.close();f?.close();}
