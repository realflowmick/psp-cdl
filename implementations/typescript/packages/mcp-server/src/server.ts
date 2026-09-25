// SPDX-License-Identifier: Apache-2.0
import { canonicalJson, parseJson, record } from "@psp-cdl/core";
import { MAX_REQUEST_BYTES, SecurityService, ServiceError, scopeFor, type Operation, type Principal } from "@psp-cdl/api-server";
import { toolDefinitions } from "./tools.js";
import { workflowToolDefinitions } from "./workflow-tools.js";
import { lifecycleToolDefinitions } from "./lifecycle-tools.js";
import { securityExtensionTools } from "./security-tools-extension.js";
import {REVISION_PROFILE,REVISION_KEY,type RevisionService} from "./revision.js";
export const MCP_VERSION="2025-11-25";
const operations:Record<string,Operation>={"realflow.security.verify":"verify","realflow.security.scan":"scan","realflow.security.decrypt":"decrypt","realflow.security.process":"process","realflow.policy.evaluate":"evaluate",
  "realflow.sessions.create":"createSession","realflow.sessions.get":"getSession","realflow.sessions.update":"updateSession",
  "realflow.nodes.fetch":"getNode","realflow.checkpoints.create":"createCheckpoint","realflow.checkpoints.resume":"resumeCheckpoint", "realflow.sessions.list":"listSessions", "realflow.sessions.cancel":"cancelSession", "realflow.sessions.purge":"purgeSession"};
export interface McpToolService {
  revisions?:RevisionService;
  authenticate(token:unknown):Promise<Principal>|Principal;
  discover(token:string, principal:Principal):Promise<unknown[]>|unknown[];
  callTool(name:string,args:Record<string,unknown>,token:string,principal:Principal):Promise<{data:Record<string,unknown>;meta?:Record<string,unknown>}>|{data:Record<string,unknown>;meta?:Record<string,unknown>};
}
function toolService(service:SecurityService|McpToolService):McpToolService {
  if(!("operations" in service)) return service;
  return {
    authenticate:t=>service.authenticate(t),
    discover:(_t,p)=>[...toolDefinitions,...workflowToolDefinitions,...lifecycleToolDefinitions,...securityExtensionTools].filter(t=>service.operations.includes(operations[t.name]!)&&p.scopes.includes(scopeFor(operations[t.name]!))),
    callTool:async(name,args,token,p)=>{
      if(!Object.hasOwn(operations,name)||!service.operations.includes(operations[name]!)) throw new ServiceError("Invalid tool or arguments",400);
      return {data:await service.invoke(operations[name]!,args,token,p)};
    }
  };
}
/** One initialized peer; trusted transports may provide immutable per-request context. */
export class McpServer {
  private phase:"new"|"initializing"|"ready"="new";
  private identity:string|undefined;
  private revisionNegotiated=false;
  private readonly service:McpToolService;
  constructor(service:SecurityService|McpToolService, private readonly credential:()=>string) {this.service=toolService(service);}
  async handle(source:string, context?:{token:string;service:McpToolService;principal?:Principal}):Promise<Record<string,unknown>|null> {
    let message:unknown;
    const error=(id:unknown,code:number,reason:string)=>({jsonrpc:"2.0",id,error:{code,message:reason}});
    try { if(Buffer.byteLength(source)>MAX_REQUEST_BYTES) throw new Error(); message=parseJson(source); }
    catch { return error(null,-32700,"Parse error"); }
    if(!record(message)||message.jsonrpc!=="2.0"||typeof message.method!=="string"||Object.keys(message).some(k=>!["jsonrpc","id","method","params"].includes(k))) return error(null,-32600,"Invalid Request");
    const notification=!Object.hasOwn(message,"id"), id=message.id;
    if(!notification&&!(typeof id==="string"||(typeof id==="number"&&Number.isSafeInteger(id)))) return error(null,-32600,"Invalid Request");
    const fail=(code:number,reason:string)=>notification?null:error(id,code,reason);
    try {
      const service=context?.service??this.service;
      const token=context?.token??this.credential(), principal=await service.authenticate(token);
      const identity=canonicalJson([principal.tenantId,principal.subjectId]);
      if(context?.principal&&identity!==canonicalJson([context.principal.tenantId,context.principal.subjectId]))return fail(-32001,"IDENTITY_CHANGED");
      if(this.identity!==undefined&&this.identity!==identity) return fail(-32001,"IDENTITY_CHANGED");
      const params=Object.hasOwn(message,"params")?message.params:{};
      if(!record(params)) return fail(-32602,"Invalid params");
      if(Object.hasOwn(params,"_meta")&&!record(params._meta)) return fail(-32602,"Invalid params");
      if(notification) {
        if(message.method==="notifications/initialized"&&this.phase==="initializing"&&Object.keys(params).every(k=>k==="_meta")) this.phase="ready";
        return null;
      }
      const success=(result:unknown)=>({jsonrpc:"2.0",id,result});
      if(message.method==="ping") return success({});
      if(message.method==="initialize") {
        if(this.phase!=="new"||typeof params.protocolVersion!=="string"||!record(params.capabilities)||!record(params.clientInfo)||typeof params.clientInfo.name!=="string"||typeof params.clientInfo.version!=="string") return fail(-32602,"Invalid initialization");
        const offered=service.revisions?.profile===REVISION_PROFILE;
        const experimental=params.capabilities.experimental;
        const requested=record(experimental)&&Object.hasOwn(experimental,REVISION_KEY);
        if(requested&&(!offered||canonicalJson(experimental[REVISION_KEY])!==canonicalJson({profile:REVISION_PROFILE})))return fail(-32000,"REVISION_UNSUPPORTED");
        this.revisionNegotiated=!!requested;
        this.identity=identity;this.phase="initializing";
        return success({protocolVersion:MCP_VERSION,capabilities:{tools:{listChanged:false},...(offered?{experimental:{[REVISION_KEY]:{profile:REVISION_PROFILE}}}:{})},serverInfo:{name:"psp-cdl-reference",version:"0.1.0"}});
      }
      if(this.phase!=="ready") return fail(-32000,"NOT_INITIALIZED");
      if(this.revisionNegotiated&&service.revisions?.profile!==REVISION_PROFILE)return fail(-32000,"REVISION_UNSUPPORTED");
      if(message.method==="tools/list") {
        if(Object.keys(params).some(k=>k!=="_meta")) return fail(-32602,"Invalid params");
        if(this.revisionNegotiated)return success(parseJson(canonicalJson(await service.revisions!.discover(token,principal))));
        return success({tools:parseJson(canonicalJson(await service.discover(token,principal)))});
      }
      if(message.method!=="tools/call") return fail(-32601,"Method not found");
      if(Object.keys(params).some(k=>!["name","arguments","_meta"].includes(k))||typeof params.name!=="string"||!record(params.arguments)) return fail(-32602,"Invalid tool or arguments");
      try {
        if(!this.revisionNegotiated&&record(params._meta)&&Object.hasOwn(params._meta,REVISION_KEY))throw new ServiceError("REVISION_UNSUPPORTED",409);
        const result=this.revisionNegotiated
          ?await service.revisions!.callTool(params.name,params.arguments,token,principal,record(params._meta)?params._meta[REVISION_KEY]??null:null)
          :await service.callTool(params.name,params.arguments,token,principal);
        return success({content:[{type:"text",text:canonicalJson(result.data)}],structuredContent:result.data,isError:false,...(result.meta?{_meta:result.meta}:{})});
      } catch(e) {
        if(e instanceof ServiceError&&e.status===400) return fail(-32602,e.code);
        const code=e instanceof ServiceError?e.code:"INTERNAL_ERROR";
        return success({content:[{type:"text",text:canonicalJson({error:{code}})}],isError:true});
      }
    } catch(e) { return fail(e instanceof ServiceError&&e.status===401?-32001:-32603,e instanceof ServiceError?e.code:"INTERNAL_ERROR"); }
  }
}
