// SPDX-License-Identifier: Apache-2.0
import {canonicalJson,parseJson,record} from "@psp-cdl/core";
import {MCP_VERSION} from "@psp-cdl/mcp-server";
import {identifier} from "@psp-cdl/api-server";
import {REVISION_PROFILE,REVISION_KEY,validCatalogRevision,type CatalogRevision} from "@psp-cdl/mcp-server/revision";
import {bounded} from "@psp-cdl/api-server/persistence";
import {type ToolRegistration,bindingDigest} from "./dispatch.js";
import {checkSchema,matches} from "./schema.js";
export class PeerError extends Error {constructor(public readonly code:string){super(code);this.name="PeerError";}}
type Approval=Omit<ToolRegistration,"server"|"invoke">;
const fail=(code:string):never=>{throw new PeerError(code);};
export function json(value:unknown):any {try{return bounded(value);}catch{return fail("INVALID_PEER_DATA");}}
/** Shared pinned discovery and buffered tool-result contract across transports. */
export abstract class PinnedMcpClient {
  private catalog:Record<string,unknown>[]=[];
  private fingerprint="";
  private requiredRevision=false;
  private revision:CatalogRevision|null=null;
  get catalogSnapshot():{tools:Record<string,unknown>[];revision:CatalogRevision|null;approvalDigest:string} {return json({tools:this.catalog,revision:this.revision,approvalDigest:this.fingerprint});}
  private digest(view:{tools:Record<string,unknown>[];revision:CatalogRevision|null}):string {return bindingDigest(this.requiredRevision?view:view.tools);}
  get catalogDigest():string{return this.fingerprint;}
  protected abstract request(method:string,params:unknown,cancelled?:()=>boolean):Promise<any>;
  protected abstract notify(method:string,params:unknown):Promise<void>;
  abstract close():Promise<void>;
  protected async initialize(info:{name:string;version:string},profile?:typeof REVISION_PROFILE):Promise<void> {
      this.requiredRevision=profile===REVISION_PROFILE;
      const init=await this.request("initialize",{protocolVersion:MCP_VERSION,capabilities:this.requiredRevision?{experimental:{[REVISION_KEY]:{profile:REVISION_PROFILE}}}:{},clientInfo:{name:"psp-cdl-mcpproxy",version:"0.1.0"}});
      if(!record(init)||init.protocolVersion!==MCP_VERSION||!record(init.serverInfo)||init.serverInfo.name!==info.name||init.serverInfo.version!==info.version||!record(init.capabilities)||!record(init.capabilities.tools)) fail("INVALID_INITIALIZATION");
      if(this.requiredRevision&&(!record(init.capabilities.experimental)||canonicalJson(init.capabilities.experimental[REVISION_KEY]??null)!==canonicalJson({profile:REVISION_PROFILE})))fail("REVISION_UNSUPPORTED");
      await this.notify("notifications/initialized",{});
      const view=await this.discover();this.catalog=view.tools;this.revision=view.revision;this.fingerprint=this.digest(view);
  }
  private async discover(cancelled?:()=>boolean):Promise<{tools:Record<string,unknown>[];revision:CatalogRevision|null}> {
    const result=await this.request("tools/list",{},cancelled);
    if(!record(result)||Object.keys(result).some(k=>k!=="tools"&&!(this.requiredRevision&&k==="_meta"))||!Array.isArray(result.tools)||result.tools.length>1024)fail("INVALID_DISCOVERY");
    const seen=new Set<string>();
    for(const t of result.tools) {
      if(!record(t)||typeof t.name!=="string"||t.name!=="realflow.security.refresh"&&(!/^[A-Za-z0-9_-]{1,64}$/.test(t.name)||/[^A-Za-z0-9_-]/.test(t.name))||seen.has(t.name)||!record(t.inputSchema)||!record(t.outputSchema))fail("INVALID_DISCOVERY");
      seen.add(t.name);
    }
    const tools=json([...result.tools].sort((a,b)=>a.name<b.name?-1:1)) as Record<string,unknown>[];
    let revision:CatalogRevision|null=null;
    if(this.requiredRevision) {
      const r=record(result._meta)?result._meta[REVISION_KEY]:null;
      if(!record(result._meta)||Object.keys(result._meta).length!==1||!validCatalogRevision(r)||r.catalogDigest!==bindingDigest(tools))fail("INVALID_REVISION_DATA");
      for(const t of tools)if(!record(t._meta)||!record(t._meta[REVISION_KEY])||Object.keys(t._meta[REVISION_KEY]).join(",")!=="toolRevision"||!identifier(t._meta[REVISION_KEY].toolRevision))fail("INVALID_REVISION_DATA");
      revision=json(r);
    }
    return {tools,revision};
  }
  /** Only explicit host approvals establish capabilities/read-only admission. */
  registrations(server:string,approvals:Approval[],now:()=>number,approvedCatalogDigest?:string):ToolRegistration[] {
    if(this.requiredRevision&&approvedCatalogDigest!==this.fingerprint)fail("CATALOG_NOT_APPROVED");
    const values=json(approvals) as Approval[],seen=new Set<string>();
    if(!Array.isArray(values)||typeof now!=="function")fail("INVALID_CONFIGURATION");
    return values.map(a=>{
      const t=this.catalog.find(t=>t.name===a.name);
      if(!t||seen.has(a.name)||canonicalJson(t.inputSchema)!==canonicalJson(a.inputSchema)||canonicalJson(t.outputSchema)!==canonicalJson(a.outputSchema))fail("DISCOVERY_MISMATCH");
      if(this.requiredRevision&&a.revision!==(t!._meta as any)?.[REVISION_KEY]?.toolRevision)fail("DISCOVERY_MISMATCH");
      seen.add(a.name);
      return {...a,server,invoke:async(args,options)=>{
        const cancelled=()=>options.cancelled()||now()>=options.deadline;
        try {
          if(this.digest(await this.discover(cancelled))!==this.fingerprint)fail("DISCOVERY_CHANGED");
          if(cancelled())fail("PEER_CANCELLED");
          const pre=this.requiredRevision?{...this.revision!,toolRevision:a.revision,inputDigest:bindingDigest(args)}:null;
          const response=await this.request("tools/call",{name:a.name,arguments:args,...(pre?{_meta:{[REVISION_KEY]:pre}}:{})},cancelled);
          if(!record(response)||Object.keys(response).some(k=>!["content","structuredContent","isError","_meta"].includes(k))||response.isError!==false&&response.isError!==undefined||!record(response.structuredContent)||!Array.isArray(response.content)||response.content.length>1)fail("INVALID_TOOL_RESPONSE");
          if(pre&&(!record(response._meta)||canonicalJson(response._meta[REVISION_KEY]??null)!==canonicalJson(pre)))fail("INVALID_REVISION_RECEIPT");
          for(const block of response.content) {
            if(!record(block)||Object.keys(block).sort().join(",")!=="text,type"||block.type!=="text"||typeof block.text!=="string"||canonicalJson(parseJson(block.text))!==canonicalJson(response.structuredContent))fail("INVALID_TOOL_RESPONSE");
          }
          if(this.digest(await this.discover(cancelled))!==this.fingerprint)fail("DISCOVERY_CHANGED");
          return json(response.structuredContent);
        }catch(e){await this.close();throw e;}
      }};
    });
  }
  /** Host-only control channel. This does not install a tool or grant model dispatch authority. */
  bindControlTool(approval:Pick<Approval,"name"|"revision"|"inputSchema"|"outputSchema">,approvedCatalogDigest:string,now:()=>number):ToolRegistration["invoke"] {
    if(approvedCatalogDigest!==this.fingerprint)fail("CATALOG_NOT_APPROVED");
    const a=json(approval);
    if(!record(a)||Object.keys(a).sort().join(",")!=="inputSchema,name,outputSchema,revision")fail("INVALID_CONFIGURATION");
    try{checkSchema(a.inputSchema);checkSchema(a.outputSchema);}catch{fail("UNSUPPORTED_SCHEMA");}
    const invoke=this.registrations("host-control",[{...a,readOnly:true,sources:[],complete:false} as Approval],now,approvedCatalogDigest)[0]!.invoke;
    return async(args,options)=>{
      const input=json(args);
      if(!options||typeof options.cancelled!=="function"||!Number.isSafeInteger(options.deadline))fail("INVALID_CONFIGURATION");
      const check=()=>{if(options.cancelled()!==false||now()>=options.deadline)fail("PEER_CANCELLED");};
      check();if(!matches(a.inputSchema,input))fail("INVALID_CONTROL_INPUT");
      const result=await invoke(input,options);check();
      if(!matches(a.outputSchema,result)){await this.close();fail("INVALID_CONTROL_OUTPUT");}
      return json(result);
    };
  }
}
