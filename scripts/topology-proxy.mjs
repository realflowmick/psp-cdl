// SPDX-License-Identifier: Apache-2.0
import {McpServer} from '@psp-cdl/mcp-server';
import {serveStdio} from '@psp-cdl/mcp-server/stdio';
import {McpDispatchGate} from '@psp-cdl/mcpproxy';
import {StdioMcpClient,createMcpProxyService} from '@psp-cdl/mcpproxy/mcp';
import {fixture} from './dispatch-fixtures.mjs';
import {caseById,approval,environment,eventLog,closeApproval} from './topology-common.mjs';
import {isolate} from './fixture-isolation.mjs';
import {dirname} from 'node:path';
import {existsSync} from 'node:fs';
const [id,executable,script,serverSpy,proxySpy]=process.argv.slice(2),c=caseById(id);
const log=eventLog(proxySpy,id);let peer,f;
const timer=setTimeout(()=>process.exit(2),30000);
let closed=false;
try {
  f=await fixture({agents:'mcp://reference/allowed',temporaryRoot:dirname(proxySpy)});
  peer=await StdioMcpClient.connect({executable,args:[script,'C',id,serverSpy],env:environment(),serverInfo:{name:'psp-cdl-reference',version:'0.1.0'},timeoutMs:4000});
  const registrations=peer.registrations('reference',['allowed','other'].map(name=>approval(name,c.input.perturbation==='proxy-policy-denial'?['used-for-model-training']:[])),f.host.now);
  const gate=new McpDispatchGate(f.store,f.host,'registry-1',registrations);
  const service=createMcpProxyService(gate,f.session.sessionId,()=>f.options);
  const control=peer.registrations('fixture-control',[closeApproval()],f.host.now)[0];
  const shutdown=async()=>{
    if(!closed){
      if(!existsSync(serverSpy+'.closed'))await control.invoke({},f.options);
      closed=true;await peer.close();peer=null;f.close();f=null;log.close();setTimeout(()=>process.exit(0),1000);
    }
  };
  // Fixed wire names bridge the local namespaced gate; discovery is not authorization.
  const wrapped={authenticate:t=>service.authenticate(t),
    discover:()=>[...registrations.map(r=>({name:r.name,inputSchema:r.inputSchema,outputSchema:r.outputSchema})),closeApproval()],
    callTool:async(name,args,token,p)=>{
      if(name==='fixture_close'&&Object.keys(args).length===0) {
        await shutdown();
        return {data:{closed:true}};
      }
      log.write('proxy-dispatch',args.recordId??null);
      try {
        const result=await service.callTool('reference.'+name,args,token,p);
        log.write('proxy-release',args.recordId,'ALLOW');return result;
      }catch(error){log.write('proxy-denied',args.recordId??null,error.code??'INTERNAL_ERROR');await shutdown();throw error;}
    }};
  isolate();log.write('isolation-probes-blocked');
  await serveStdio(new McpServer(wrapped,()=> 'test-owner'));
}finally {clearTimeout(timer);try {await peer?.close();}finally{f?.close();if(!closed)log.close();}}
