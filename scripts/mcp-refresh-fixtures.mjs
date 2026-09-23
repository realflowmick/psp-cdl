// SPDX-License-Identifier: Apache-2.0
import {readFileSync} from 'node:fs';
import {PinnedMcpClient,PeerError} from '@psp-cdl/mcpproxy/mcp';
import {McpServer} from '@psp-cdl/mcp-server';
import {canonicalJson,envelopeToSection,serializeMarkup} from '@psp-cdl/core';
import {signEnvelope} from '@psp-cdl/core/crypto';
import {McpPromptRefresher,mcpRefreshToolDefinition} from '@psp-cdl/llmproxy';
export const suite=JSON.parse(readFileSync(new URL('../conformance/vectors/llm/mcp-refresh-0.1.json',import.meta.url),'utf8'));
export const principal={tenantId:'tenant',subjectId:'owner',scopes:['models:invoke','sessions:write']};
export const binding={tenantId:'tenant',subjectId:'owner',sessionId:'session-1',deadline:2000};
export const request={session_id:'session-1',current_version:'1.0.0',trigger:'expiration',turn_count:2};
export const markup=e=>serializeMarkup({kind:'document',children:[envelopeToSection(e)]},'canonical');
const envelope=()=>signEnvelope('Fresh system 🧪',{algorithm:'hmac-sha256',signatureVersion:'2.0',secretId:'synthetic',timestamp:1100,expires:1600,version:'1.0.1',sectionType:'system',contentType:'text'},new Uint8Array(32).fill(19));

export class TestPeer extends PinnedMcpClient {
  calls=0;lists=0;closed=false;wire=[];now=1100;cancelled=false;
  constructor(mode='normal',issue=()=>envelope()) {
    super();this.mode=mode;this.issue=issue;
    this.service={authenticate:()=>principal,discover:()=>this.discoverTools(),callTool:async(name,args)=>{
      this.calls++;this.wire.push({name,arguments:args});
      let e=await this.issue(args),prompt=markup(e);
      if(mode==='malformed')prompt='not a section';
      if(mode==='multiple')prompt+=prompt;
      if(mode==='not-system'){e.signature.sectionType='user';prompt=markup(e);}
      if(mode==='nested')prompt='${psp type=system}${psp type=user}nested${/psp}${/psp}';
      if(mode==='expired-after')this.now=2000;
      if(mode==='cancelled-after')this.cancelled=true;
      return {data:mode==='extra-output'?{prompt,secret:'PRIVATE'}:mode==='missing-output'?{}:mode==='oversize-output'?{prompt:'x'.repeat(262145)}:{prompt},meta:{untrusted:'PRIVATE_META'}};
    }};
    this.server=new McpServer(this.service,()=> 'synthetic');
  }
  discoverTools(){
    this.lists++;const tool=mcpRefreshToolDefinition();
    if(this.mode==='equivalent')tool.name='refresh';
    if(this.mode==='missing')return [];
    if(this.mode==='schema')tool.inputSchema.properties.turn_count.maximum=99;
    if(this.mode==='drift-before'&&this.lists>1||this.mode==='drift-after'&&this.calls)tool.description='changed';
    return this.mode==='duplicate'?[tool,tool]:[tool];
  }
  async connect(){await this.initialize({name:'psp-cdl-reference',version:'0.1.0'});return this;}
  async request(method,params,cancelled=()=>false){
    if(cancelled())throw new PeerError('PEER_CANCELLED');
    const reply=await this.server.handle(canonicalJson({jsonrpc:'2.0',id:1,method,params}));
    if(reply.error)throw new PeerError('PEER_ERROR');
    if(method==='tools/call'&&this.mode==='bad-text')reply.result.content=[{type:'text',text:'PRIVATE'}];
    return reply.result;
  }
  async notify(method,params){await this.server.handle(canonicalJson({jsonrpc:'2.0',method,params}));}
  async close(){this.closed=true;}
}
export async function runCase(c){
  const peer=new TestPeer(c.mode),p=structuredClone(principal),b=structuredClone(binding),r={...request,...c.request};
  try{
    await peer.connect();
    const client=new McpPromptRefresher(peer,{principal:p,sessionId:b.sessionId,approvedCatalogDigest:c.mode==='unapproved'?'wrong':peer.catalogDigest,now:()=>peer.now,cancelled:()=>peer.cancelled,...(c.mode==='equivalent'?{toolName:'refresh'}:{})});
    if(c.mode==='owner')p.subjectId='other';
    if(c.mode==='binding')b.tenantId='other';
    if(c.mode==='session')r.session_id='other';
    if(c.mode==='expired')peer.now=2000;
    if(c.mode==='cancelled')peer.cancelled=true;
    const result=await client.refresh(p,b,r);
    return {code:'OK',calls:peer.calls,released:1,data:result.data,wire:peer.wire};
  }catch(e){return {code:e.code??'UNEXPECTED_ERROR',calls:peer.calls,released:0,wire:peer.wire};}
  finally{await peer.close();}
}
