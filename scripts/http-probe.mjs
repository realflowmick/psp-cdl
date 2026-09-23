// SPDX-License-Identifier: Apache-2.0
import {readFileSync,existsSync} from 'node:fs';
import {HttpMcpClient} from '@psp-cdl/mcpproxy/mcp';
import {McpDispatchGate} from '@psp-cdl/mcpproxy';
import {fixture} from './dispatch-fixtures.mjs';
import {suite,runHttpCase,approval} from './http-fixtures.mjs';
if(process.argv[2]==='--report') {
  const result=[];for(const c of suite.cases)result.push(await runHttpCase(c));console.log(JSON.stringify(result));
}else {
  const c=JSON.parse(process.argv[2]);let peer,f;
  try {
    peer=await HttpMcpClient.connect({endpoint:c.endpoint,allowLoopbackHttp:!c.rejectHttp,serverInfo:{name:'psp-cdl-reference',version:'0.1.0'},timeoutMs:700,...(c.ca?{caPem:readFileSync(c.ca,'utf8')}:{})},resource=>{if(resource!==c.endpoint)throw Error('resource mismatch');return c.token??'test-downstream';});
    f=await fixture(c.settings??{});
    const gate=new McpDispatchGate(f.store,f.host,'registry-1',peer.registrations('echo',[approval],()=>1000));
    const options={deadline:1800,cancelled:()=>!!c.cancel&&existsSync(c.spy)&&readFileSync(c.spy,'utf8').includes('call')};
    const result=await gate.callTool('test-owner',f.session.sessionId,{name:'echo.read',arguments:{message:'hello 🧪'}},options);
    console.log(JSON.stringify({code:'OK',released:1,data:result.data,trustLevel:result.provenance.trustLevel}));
  }catch(e){console.log(JSON.stringify({code:e.code??'UNEXPECTED_ERROR',released:0}));}
  finally{await peer?.close();f?.close();}
}
