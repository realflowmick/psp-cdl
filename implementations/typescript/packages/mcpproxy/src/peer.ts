// SPDX-License-Identifier: Apache-2.0
import {canonicalJson,parseJson,record} from "@psp-cdl/core";
import {MCP_VERSION} from "@psp-cdl/mcp-server";
import {bounded} from "@psp-cdl/api-server/persistence";
import {type ToolRegistration,bindingDigest} from "./dispatch.js";
export class PeerError extends Error {constructor(public readonly code:string){super(code);this.name="PeerError";}}
type Approval=Omit<ToolRegistration,"server"|"invoke">;
const fail=(code:string):never=>{throw new PeerError(code);};
export function json(value:unknown):any {try{return bounded(value);}catch{return fail("INVALID_PEER_DATA");}}
/** Shared pinned discovery and buffered tool-result contract across transports. */
export abstract class PinnedMcpClient {
  private catalog:Record<string,unknown>[]=[];
  private fingerprint="";
  get catalogDigest():string{return this.fingerprint;}
  protected abstract request(method:string,params:unknown,cancelled?:()=>boolean):Promise<any>;
  protected abstract notify(method:string,params:unknown):Promise<void>;
  abstract close():Promise<void>;
  protected async initialize(info:{name:string;version:string}):Promise<void> {
      const init=await this.request("initialize",{protocolVersion:MCP_VERSION,capabilities:{},clientInfo:{name:"psp-cdl-mcpproxy",version:"0.1.0"}});
      if(!record(init)||init.protocolVersion!==MCP_VERSION||!record(init.serverInfo)||init.serverInfo.name!==info.name||init.serverInfo.version!==info.version||!record(init.capabilities)||!record(init.capabilities.tools)) fail("INVALID_INITIALIZATION");
      await this.notify("notifications/initialized",{});
      this.catalog=await this.discover();this.fingerprint=bindingDigest(this.catalog);
  }
  private async discover(cancelled?:()=>boolean):Promise<Record<string,unknown>[]> {
    const result=await this.request("tools/list",{},cancelled);
    if(!record(result)||Object.keys(result).some(k=>k!=="tools")||!Array.isArray(result.tools)||result.tools.length>1024)fail("INVALID_DISCOVERY");
    const seen=new Set<string>();
    for(const t of result.tools) {
      if(!record(t)||typeof t.name!=="string"||!/^[A-Za-z0-9_-]{1,64}$/.test(t.name)||seen.has(t.name)||!record(t.inputSchema)||!record(t.outputSchema))fail("INVALID_DISCOVERY");
      seen.add(t.name);
    }
    return json([...result.tools].sort((a,b)=>a.name<b.name?-1:1));
  }
  /** Only explicit host approvals establish capabilities/read-only admission. */
  registrations(server:string,approvals:Approval[],now:()=>number):ToolRegistration[] {
    const values=json(approvals) as Approval[],seen=new Set<string>();
    if(!Array.isArray(values)||typeof now!=="function")fail("INVALID_CONFIGURATION");
    return values.map(a=>{
      const t=this.catalog.find(t=>t.name===a.name);
      if(!t||seen.has(a.name)||canonicalJson(t.inputSchema)!==canonicalJson(a.inputSchema)||canonicalJson(t.outputSchema)!==canonicalJson(a.outputSchema))fail("DISCOVERY_MISMATCH");
      seen.add(a.name);
      return {...a,server,invoke:async(args,options)=>{
        const cancelled=()=>options.cancelled()||now()>=options.deadline;
        try {
          if(bindingDigest(await this.discover(cancelled))!==this.fingerprint)fail("DISCOVERY_CHANGED");
          if(cancelled())fail("PEER_CANCELLED");
          const response=await this.request("tools/call",{name:a.name,arguments:args},cancelled);
          if(!record(response)||Object.keys(response).some(k=>!["content","structuredContent","isError","_meta"].includes(k))||response.isError!==false&&response.isError!==undefined||!record(response.structuredContent)||!Array.isArray(response.content)||response.content.length>1)fail("INVALID_TOOL_RESPONSE");
          for(const block of response.content) {
            if(!record(block)||Object.keys(block).sort().join(",")!=="text,type"||block.type!=="text"||typeof block.text!=="string"||canonicalJson(parseJson(block.text))!==canonicalJson(response.structuredContent))fail("INVALID_TOOL_RESPONSE");
          }
          if(bindingDigest(await this.discover(cancelled))!==this.fingerprint)fail("DISCOVERY_CHANGED");
          return json(response.structuredContent);
        }catch(e){await this.close();throw e;}
      }};
    });
  }
}
