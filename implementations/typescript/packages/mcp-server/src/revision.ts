// SPDX-License-Identifier: Apache-2.0
import {createHash,randomUUID} from "node:crypto";
import {canonicalJson,record} from "@psp-cdl/core";
import {SecurityService,ServiceError,identifier,type Principal} from "@psp-cdl/api-server";
import {bounded} from "@psp-cdl/api-server/persistence";
import type {McpToolService} from "./server.js";

export const REVISION_PROFILE="PSP-MCP-REVISION-0.1";
export const REVISION_KEY="psp-cdl.org/revision";
export interface CatalogRevision {profile:typeof REVISION_PROFILE;epoch:string;generation:number;catalogDigest:string}
export interface RevisionPrecondition extends CatalogRevision {toolRevision:string;inputDigest:string}
export interface RevisionTool {
  name:string;revision:string;readOnly:true;inputSchema:Record<string,unknown>;outputSchema:Record<string,unknown>;
  invoke(args:Record<string,unknown>,context:{principal:Principal;cancelled:()=>boolean}):Record<string,unknown>|Promise<Record<string,unknown>>;
}
export interface RevisionHost {
  authenticate(token:string):Principal|null|Promise<Principal|null>;
  authorize(principal:Principal,name:string|null,phase:"discover"|"invoke"|"release"):boolean|Promise<boolean>;
}
export interface RevisionService {
  profile:typeof REVISION_PROFILE;
  discover(token:string,principal:Principal):Promise<Record<string,unknown>>;
  callTool(name:string,args:Record<string,unknown>,token:string,principal:Principal,precondition:unknown):Promise<{data:Record<string,unknown>;meta:Record<string,unknown>}>;
}
export const revisionDigest=(value:unknown):string=>createHash("sha256").update(canonicalJson(value)).digest("hex");
function fail(code:string,status=409):never {throw new ServiceError(code,status);}
const clone=(v:unknown):any=>{try{return bounded(v);}catch{return fail("INVALID_REVISION_DATA",400);}};
const identity=(p:Principal)=>canonicalJson([p.tenantId,p.subjectId]);
export function validCatalogRevision(v:unknown):v is CatalogRevision {
  return record(v)&&Object.keys(v).sort().join(",")==="catalogDigest,epoch,generation,profile"&&v.profile===REVISION_PROFILE&&identifier(v.epoch)&&typeof v.generation==="number"&&Number.isSafeInteger(v.generation)&&v.generation>0&&typeof v.catalogDigest==="string"&&v.catalogDigest.length===64&&/^[a-f0-9]{64}$/.test(v.catalogDigest);
}

/** All publishers and invocations for this catalog must share this process-local registry. */
export class RevisionedToolRegistry {
  private readonly auth:SecurityService;
  private active=0;
  private generation=1;
  private state:ReturnType<RevisionedToolRegistry["prepare"]>;
  constructor(private readonly host:RevisionHost,tools:RevisionTool[],private readonly epoch:string=randomUUID()) {
    if(!identifier(epoch)||typeof host.authenticate!=="function"||typeof host.authorize!=="function")fail("INVALID_CONFIGURATION",400);
    this.auth=new SecurityService({authenticate:t=>host.authenticate(t),resolve:()=>null,now:Date.now});
    this.state=this.prepare(tools);
  }
  private prepare(tools:RevisionTool[]) {
    if(!Array.isArray(tools)||tools.length>1024)fail("INVALID_CONFIGURATION",400);
    const handlers=new Map<string,RevisionTool["invoke"]>(),catalog:Record<string,unknown>[]=[];
    for(const tool of tools) {
      if(!record(tool))fail("INVALID_CONFIGURATION",400);
      const {invoke,...value}=tool,meta=clone(value);
      if(Object.keys(meta).sort().join(",")!=="inputSchema,name,outputSchema,readOnly,revision"||typeof meta.name!=="string"||!/^[A-Za-z0-9_-]{1,64}$/.test(meta.name)||/[^A-Za-z0-9_-]/.test(meta.name)||!identifier(meta.revision)||meta.readOnly!==true||!record(meta.inputSchema)||meta.inputSchema.type!=="object"||!record(meta.outputSchema)||meta.outputSchema.type!=="object"||typeof invoke!=="function"||handlers.has(meta.name))fail("INVALID_CONFIGURATION",400);
      handlers.set(meta.name,invoke);
      catalog.push({name:meta.name,inputSchema:meta.inputSchema,outputSchema:meta.outputSchema,_meta:{[REVISION_KEY]:{toolRevision:meta.revision}}});
    }
    catalog.sort((a,b)=>(a.name as string)<(b.name as string)?-1:1);
    return {handlers,catalog:clone(catalog) as Record<string,unknown>[],digest:revisionDigest(catalog)};
  }
  get revision():CatalogRevision {return {profile:REVISION_PROFILE,epoch:this.epoch,generation:this.generation,catalogDigest:this.state.digest};}
  /** Fail-fast compare-and-replace. A lease prevents replacement until buffered completion. */
  publish(expected:CatalogRevision,tools:RevisionTool[]):CatalogRevision {
    if(!validCatalogRevision(expected)||canonicalJson(expected)!==canonicalJson(this.revision))fail("REVISION_CONFLICT");
    if(this.active)fail("REGISTRY_BUSY");
    if(this.generation===Number.MAX_SAFE_INTEGER)fail("REVISION_EXHAUSTED");
    const next=this.prepare(tools);this.state=next;this.generation++;
    return this.revision;
  }
  private async authorized(token:string,expected:Principal,name:string|null,phase:"discover"|"invoke"|"release"):Promise<Principal> {
    const p=await this.auth.authenticate(token);
    if(identity(p)!==identity(expected)||!p.scopes.includes(phase==="discover"?"tools:list":"tools:call")||await this.host.authorize(clone(p),name,phase)!==true)fail("FORBIDDEN",403);
    return p;
  }
  service(cancelled:()=>boolean=()=>false):McpToolService {
    const check=()=>{if(cancelled()!==false)fail("CANCELLED");};
    return {
      authenticate:t=>this.auth.authenticate(t),
      discover:()=>fail("REVISION_REQUIRED"),callTool:()=>fail("REVISION_REQUIRED"),
      revisions:{profile:REVISION_PROFILE,
        discover:async(token,p)=>{
          await this.authorized(token,p,null,"discover");check();
          return clone({tools:this.state.catalog,_meta:{[REVISION_KEY]:this.revision}});
        },
        callTool:async(name,args,token,p,raw)=>{
          const data=clone(args),pre=clone(raw);
          if(!record(data)||!record(pre)||Object.keys(pre).sort().join(",")!=="catalogDigest,epoch,generation,inputDigest,profile,toolRevision")fail("INVALID_PRECONDITION",400);
          const principal=await this.authorized(token,p,name,"invoke");check();
          const tool=this.state.catalog.find(t=>t.name===name),revision=this.revision;
          const expected={...revision,toolRevision:(tool?._meta as any)?.[REVISION_KEY]?.toolRevision,inputDigest:revisionDigest(data)};
          if(!tool||canonicalJson(pre)!==canonicalJson(expected))fail("REVISION_MISMATCH");
          const invoke=this.state.handlers.get(name)!;
          // No await between comparison, selecting the immutable callback and acquiring its lease.
          this.active++;
          try {
            const output=clone(await invoke(data,{principal:clone(principal),cancelled}));
            if(!record(output))fail("INVALID_OUTPUT",500);
            check();await this.authorized(token,p,name,"release");check();
            return clone({data:output,meta:{[REVISION_KEY]:pre}});
          }finally{this.active--;}
        }
      }
    };
  }
}
