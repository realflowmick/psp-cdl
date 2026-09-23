// SPDX-License-Identifier: Apache-2.0
import { createHash } from "node:crypto";
import { canonicalJson, record } from "@psp-cdl/core";
import { aggregateCapabilities, evaluateBatch, type PolicyInput } from "@psp-cdl/cdl";
import { SecurityService, ServiceError, identifier, type Principal } from "@psp-cdl/api-server";
import { WorkflowStore, OwnerCoordinator, StoreError, bounded, integer, type Actor } from "@psp-cdl/api-server/persistence";
import { checkSchema, matches } from "./schema.js";

export const DISPATCH_PROFILE="PSP-MCP-DISPATCH-0.1";
export class DispatchError extends Error {
  constructor(public readonly code:string) { super(code); this.name="DispatchError"; }
}
export interface CapabilitySource { id:string; capabilities:unknown }
export interface ToolRegistration {
  server:string; name:string; revision:string; readOnly:boolean;
  sources:CapabilitySource[]; complete:boolean; inputSchema:Record<string,unknown>; outputSchema:Record<string,unknown>;
  invoke(args:Record<string,unknown>, context:CallOptions):unknown|Promise<unknown>;
}
export interface AuthoritySnapshot {
  revision:string; policyVersion:string; registryRevision:string; expires:number;
  releaseSources:CapabilitySource[]; releaseComplete:boolean;
}
export interface DispatchHost {
  authenticate(token:string):Principal|null|Promise<Principal|null>;
  now():number;
  snapshot(principal:Principal, session:Record<string,unknown>):AuthoritySnapshot|Promise<AuthoritySnapshot>;
  policy(principal:Principal, binding:Record<string,unknown>, data:Record<string,unknown>, phase:"dispatch"|"release"):
    {bindingDigest:string;resources:PolicyInput[]}|Promise<{bindingDigest:string;resources:PolicyInput[]}>;
}
/** Host-owned controls; never accept these fields in model tool arguments. */
export interface CallOptions { deadline:number; cancelled:()=>boolean }
const fail=(code:string):never=>{throw new DispatchError(code);};
export const bindingDigest=(value:unknown):string=>createHash("sha256").update(canonicalJson(value)).digest("hex");
const part=(v:unknown):v is string=>typeof v==="string"&&v.length<=64&&/^[A-Za-z0-9_-]+$/.test(v)&&!/[^A-Za-z0-9_-]/.test(v);
function copy(value:unknown,code="INVALID_REQUEST"):any { try {return bounded(value);} catch {return fail(code);} }
async function callback<T>(work:()=>T|Promise<T>,code="HOST_ERROR"):Promise<T> {try{return await work();}catch{return fail(code);}}
function capabilities(sources:CapabilitySource[],complete:boolean):string[] {
  try {return aggregateCapabilities(sources,complete);} catch {return fail("INVALID_CAPABILITIES");}
}
function affinity(node:Record<string,unknown>):Set<string> {
  const def=node.definition;
  if(!record(def)) return fail("UNSUPPORTED_AFFINITY");
  const value=Object.hasOwn(def,"agents")?def.agents:"";
  if(typeof value!=="string") return fail("UNSUPPORTED_AFFINITY");
  const uris=value===""?[]:value.split(",").map(v=>v.replace(/^[ \t\r\n]+|[ \t\r\n]+$/g,""));
  if(uris.length>1024||uris.some(u=>!/^mcp:\/\/[A-Za-z0-9_-]{1,64}\/[A-Za-z0-9_-]{1,64}$/.test(u))) return fail("UNSUPPORTED_AFFINITY");
  return new Set(uris);
}
interface Tool { meta:Omit<ToolRegistration,"invoke">; invoke:ToolRegistration["invoke"]; caps:string[]; uri:string; name:string }

/** A gate library, not a network proxy. Registry entries come from authenticated host adapters. */
export class McpDispatchGate {
  private readonly tools=new Map<string,Tool>();
  private readonly auth:SecurityService;
  private readonly coordinator:OwnerCoordinator;
  constructor(private readonly store:WorkflowStore, private readonly host:DispatchHost, private readonly registryRevision:string, registrations:ToolRegistration[]) {
    if(!(store.coordinator instanceof OwnerCoordinator)||!identifier(registryRevision)||!Array.isArray(registrations)||registrations.length>1024||[host.authenticate,host.now,host.snapshot,host.policy].some(v=>typeof v!=="function")) fail("INVALID_CONFIGURATION");
    this.coordinator=store.coordinator!;
    this.auth=new SecurityService({authenticate:t=>host.authenticate(t),now:()=>host.now(),resolve:()=>null});
    for(const r of registrations) {
      const {invoke,...metadata}=r, meta=copy(metadata,"INVALID_CONFIGURATION") as Tool["meta"];
      if(Object.keys(meta).sort().join(",")!=="complete,inputSchema,name,outputSchema,readOnly,revision,server,sources"||!part(meta.server)||!part(meta.name)||!identifier(meta.revision)||typeof meta.readOnly!=="boolean"||typeof invoke!=="function") fail("INVALID_CONFIGURATION");
      try {checkSchema(meta.inputSchema);checkSchema(meta.outputSchema);}catch{fail("UNSUPPORTED_SCHEMA");}
      if(meta.inputSchema.type!=="object"||meta.outputSchema.type!=="object") fail("UNSUPPORTED_SCHEMA");
      const name=meta.server+"."+meta.name;
      if(this.tools.has(name)) fail("INVALID_CONFIGURATION");
      this.tools.set(name,{meta,invoke,caps:capabilities(meta.sources,meta.complete),name,uri:"mcp://"+meta.server+"/"+meta.name});
    }
  }
  private check(options:CallOptions,expires=Number.MAX_SAFE_INTEGER):void {
    if(!options||!integer(options.deadline)||typeof options.cancelled!=="function") fail("INVALID_REQUEST");
    const now=this.host.now(), cancelled=options.cancelled();
    if(!integer(now)||typeof cancelled!=="boolean") fail("HOST_ERROR");
    if(cancelled) fail("CANCELLED");
    if(now>=options.deadline) fail("DEADLINE_EXCEEDED");
    if(now>=expires) fail("STALE_AUTHORITY");
  }
  private async principal(token:unknown,scope:string,expected?:Principal):Promise<Principal> {
    const p=await this.auth.authenticate(token);
    if(!p.scopes.includes(scope)||expected&&(p.tenantId!==expected.tenantId||p.subjectId!==expected.subjectId)) fail("FORBIDDEN");
    return p;
  }
  private async snapshot(p:Principal,session:Record<string,unknown>):Promise<AuthoritySnapshot> {
    const s=copy(await callback(()=>this.host.snapshot(copy(p),copy(session))),"INVALID_AUTHORITY");
    if(!record(s)||Object.keys(s).sort().join(",")!=="expires,policyVersion,registryRevision,releaseComplete,releaseSources,revision"||!identifier(s.revision)||s.policyVersion!==session.policyVersion||s.registryRevision!==this.registryRevision||!integer(s.expires)) fail("STALE_AUTHORITY");
    capabilities(s.releaseSources as CapabilitySource[],s.releaseComplete as boolean);
    return s as unknown as AuthoritySnapshot;
  }
  private async boundary<T>(work:()=>Promise<T>):Promise<T> {
    try {return await work();} catch(e) {
      if(e instanceof DispatchError) throw e;
      if(e instanceof ServiceError&&["UNAUTHENTICATED","FORBIDDEN"].includes(e.code)) fail(e.code);
      if(e instanceof StoreError&&["NOT_FOUND","EXPIRED","STATE_BUSY"].includes(e.code)) fail(e.code);
      return fail("HOST_ERROR");
    }
  }
  private async within<T>(token:unknown,sessionId:string,scope:string,options:CallOptions,work:(p:Principal,s:Record<string,unknown>,a:AuthoritySnapshot,allowed:Set<string>,fresh:()=>Promise<void>)=>Promise<T>):Promise<T> {
    return this.boundary(async()=>{
      const p=await this.principal(token,scope), actor:Actor={tenantId:p.tenantId,subjectId:p.subjectId};
      this.check(options);
      return this.coordinator.run(actor,async()=>{
        const session=await this.store.execute(actor,{action:"getSession",sessionId});
        if(session.status!=="running") fail("INACTIVE_SESSION");
        const node=await this.store.execute(actor,{action:"getNode",nodeId:session.nodeId,nodeVersion:session.nodeVersion});
        const authority=await this.snapshot(p,session), expires=Math.min(authority.expires,session.expiresAt as number);
        this.check(options,expires);
        const fresh=async()=>{
          await this.principal(token,scope,p);
          if(canonicalJson(await this.snapshot(p,session))!==canonicalJson(authority)) fail("STALE_AUTHORITY");
          // Detect unsupported writers that bypassed the coordinator while callbacks ran.
          if(canonicalJson(await this.store.execute(actor,{action:"getSession",sessionId}))!==canonicalJson(session)) fail("STALE_SESSION");
          this.check(options,expires);
        };
        return work(p,session,authority,affinity(node),fresh);
      });
    });
  }
  async listTools(token:unknown,sessionId:string,options:CallOptions):Promise<Record<string,unknown>[]> {
    options={deadline:options?.deadline,cancelled:options?.cancelled};
    return this.within(token,sessionId,"tools:list",options,async(_p,_s,_a,allowed,fresh)=>{
      const tools=[...this.tools.values()].filter(t=>t.meta.readOnly&&allowed.has(t.uri)).sort((a,b)=>a.name<b.name?-1:1).map(t=>({name:t.name,inputSchema:copy(t.meta.inputSchema),outputSchema:copy(t.meta.outputSchema)}));
      await fresh(); return copy(tools,"INVALID_OUTPUT");
    });
  }
  async callTool(token:unknown,sessionId:string,request:unknown,options:CallOptions):Promise<Record<string,unknown>> {
    options={deadline:options?.deadline,cancelled:options?.cancelled};
    return this.within(token,sessionId,"tools:call",options,async(p,session,authority,allowed,fresh)=>{
      const r=copy(request);
      if(!record(r)||Object.keys(r).sort().join(",")!=="arguments,name"||typeof r.name!=="string"||!record(r.arguments)) fail("INVALID_REQUEST");
      const tool=this.tools.get(r.name as string);
      if(!tool||!allowed.has(tool.uri)) return fail("TOOL_NOT_ALLOWED");
      if(!tool.meta.readOnly) fail("UNSUPPORTED_TOOL_MODE");
      if(!matches(tool.meta.inputSchema,r.arguments)) fail("INVALID_ARGUMENTS");
      const binding={tenantId:p.tenantId,subjectId:p.subjectId,sessionId,sessionVersion:session.version,nodeId:session.nodeId,nodeVersion:session.nodeVersion,epoch:this.store.epoch,policyVersion:authority.policyVersion,authorityRevision:authority.revision,registryRevision:this.registryRevision,toolUri:tool.uri,toolRevision:tool.meta.revision,inputDigest:bindingDigest(r.arguments),deadline:options.deadline};
      const decide=async(phase:"dispatch"|"release",data:Record<string,unknown>,bound:Record<string,unknown>,caps:string[])=>{
        const context={...bound,phase}, digest=bindingDigest(context);
        const policy=copy(await callback(()=>this.host.policy(copy(p),copy(context),copy(data),phase)),"INVALID_POLICY");
        if(!record(policy)||policy.bindingDigest!==digest||!Array.isArray(policy.resources)||!policy.resources.length) fail("INVALID_POLICY");
        const inputs=(policy.resources as PolicyInput[]).map(v=>({...v,capabilities:capabilities([{id:"registry",capabilities:caps},{id:"resource",capabilities:v.capabilities}],true)}));
        const decision=evaluateBatch(inputs).decision;
        if(decision==="unsupported") fail("UNSUPPORTED_POLICY");
        if(decision!=="allow") fail(phase==="dispatch"?"POLICY_DENIED":"OUTPUT_DENIED");
      };
      await decide("dispatch",r.arguments as Record<string,unknown>,binding,tool.caps);
      await fresh();
      this.check(options,Math.min(authority.expires,session.expiresAt as number));
      // No await between final check and entering the pinned endpoint callback.
      const output=copy(await callback(()=>tool.invoke(copy(r.arguments),{deadline:options.deadline,cancelled:options.cancelled}),"TOOL_FAILED"),"INVALID_OUTPUT");
      this.check(options,Math.min(authority.expires,session.expiresAt as number));
      if(!matches(tool.meta.outputSchema,output)) fail("INVALID_OUTPUT");
      const outputDigest=bindingDigest(output);
      await decide("release",output,{...binding,outputDigest},capabilities(authority.releaseSources,authority.releaseComplete));
      await fresh();
      return {data:output,provenance:{profile:DISPATCH_PROFILE,toolUri:tool.uri,toolRevision:tool.meta.revision,registryRevision:this.registryRevision,inputDigest:binding.inputDigest,outputDigest,trustLevel:5}};
    });
  }
}
