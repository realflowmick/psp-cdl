// SPDX-License-Identifier: Apache-2.0
import {HttpMcpClient,StdioMcpClient} from '@psp-cdl/mcpproxy/mcp';
import {McpPromptRefresher} from '@psp-cdl/llmproxy';
import {verifyEnvelope} from '@psp-cdl/core/crypto';
import {principal,binding,request} from './mcp-refresh-fixtures.mjs';
const c=JSON.parse(process.argv[2]);let peer;
try{
  peer=c.transport==='http'?await HttpMcpClient.connect(c.config,()=>c.badToken?'wrong':'synthetic-refresh-token'):await StdioMcpClient.connect(c.config);
  const client=new McpPromptRefresher(peer,{principal,sessionId:binding.sessionId,approvedCatalogDigest:c.unapproved?'wrong':peer.catalogDigest,now:()=>1100,cancelled:()=>false});
  const envelope=await client.refresh(principal,binding,request);
  verifyEnvelope(envelope,{now:1100,context:{},allowedAttributes:[],keys:[{id:'synthetic',status:'active',algorithm:'hmac-sha256',material:new Uint8Array(32).fill(19),allowUnscoped:true,scope:{},trustLevels:[2],sectionTypes:['system']}]});
  console.log(JSON.stringify({code:'OK',released:1,data:envelope.data}));
}catch(e){console.log(JSON.stringify({code:e.code??'UNEXPECTED_ERROR',released:0}));}
finally{await peer?.close();}
