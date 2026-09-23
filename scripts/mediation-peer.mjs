// SPDX-License-Identifier: Apache-2.0
// Adversarial, synthetic downstream used only by tests. No real credentials/data.
import {appendFileSync} from 'node:fs';
import {McpServer} from '@psp-cdl/mcp-server';
import {serveStdio} from '@psp-cdl/mcp-server/stdio';
import {canonicalJson} from '@psp-cdl/core';
import {suite} from './dispatch-fixtures.mjs';
const [mode='normal',spy]=process.argv.slice(2);
let lists=0,calls=0;
const tools={
  authenticate:token=>{if(token!=='test-downstream')throw Object.assign(new Error(),{code:'UNAUTHENTICATED'});return {tenantId:'downstream',subjectId:'launcher',scopes:[]};},
  discover:()=>{
    lists++;
    const t={name:'read',inputSchema:structuredClone(suite.schema),outputSchema:structuredClone(suite.schema),annotations:{readOnlyHint:true},_meta:{revision:'1'}};
    if(mode==='write-hang')for(const s of [t.inputSchema,t.outputSchema])s.properties.message.maxLength=300000;
    if(mode==='drift-before'&&lists>1||mode==='drift-after'&&calls) t._meta.revision='2';
    if(mode==='schema-drift'&&lists>1)t.inputSchema.properties.message.maxLength=31;
    return mode==='duplicate'?[t,t]:[t];
  },
  callTool:async(name,args)=>{
    if(name!=='read')throw new Error('PRIVATE_TOOL_NAME');
    calls++;appendFileSync(spy,'call\n');
    if(mode==='hang')await new Promise(r=>setTimeout(r,5000));
    if(mode==='tool-error')throw new Error('PRIVATE_TOOL_DETAIL');
    return {data:{message:mode==='bad-data'?42:args.message},meta:{'psp-cdl/provenance':{trustLevel:0,secret:'PRIVATE_PEER_META'}}};
  }
};
const server=new McpServer(tools,()=>process.env.PSP_TEST_CREDENTIAL??'');
const original=server.handle.bind(server);
server.handle=async source=>{
  const reply=await original(source),message=JSON.parse(source);
  if(!reply?.result)return reply;
  if(message.method==='initialize') {
    if(mode==='bad-version')reply.result.protocolVersion='unrecognized';
    if(mode==='bad-server')reply.result.serverInfo.name='unrecognized';
  }
  if(message.method==='tools/list'&&mode==='pagination')reply.result.nextCursor='opaque';
  if(message.method==='tools/list'&&mode==='write-hang'&&lists===2) {
    process.stdout.write(canonicalJson(reply)+'\n');
    await new Promise(r=>setTimeout(r,5000));return null;
  }
  if(message.method==='tools/call') {
    if(mode==='wrong-id')reply.id=999;
    if(mode==='bad-text')reply.result.content=[{type:'text',text:'PRIVATE_UNCHECKED_TEXT'}];
    if(mode==='image')reply.result.content=[{type:'image',data:'PRIVATE_IMAGE',mimeType:'image/png'}];
    if(mode==='missing-structured')delete reply.result.structuredContent;
    if(mode==='oversize'){process.stdout.write('x'.repeat(1_048_577)+'\n');return null;}
    if(mode==='invalid-utf8'){process.stdout.write(Buffer.from([255,10]));return null;}
    if(mode==='truncated'){process.stdout.write('{');process.exitCode=0;process.stdin.destroy();return null;}
    if(mode==='notification'){process.stdout.write(canonicalJson({jsonrpc:'2.0',method:'notifications/tools/list_changed'})+'\n');return reply;}
  }
  return reply;
};
await serveStdio(server);
