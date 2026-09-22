// SPDX-License-Identifier: Apache-2.0
import { randomUUID } from "node:crypto";
import { canonicalJson, validateJson } from "@psp-cdl/core";
import { WorkflowStore } from "./persistence.js";
import { workflowError, type WorkflowAuthority } from "./workflow.js";
import { ServiceError, identifier, type ServiceHost, type Principal, type OperationSnapshot } from "./service.js";

export interface SessionOperationHost extends WorkflowAuthority {
  authenticate:ServiceHost["authenticate"];
  now:ServiceHost["now"];
  snapshot(principal:Principal, session:Record<string,unknown>, operationId:string):Pick<OperationSnapshot,"verification"|"resources"|"expires">|Promise<Pick<OperationSnapshot,"verification"|"resources"|"expires">>;
}
interface Binding { tenantId:string; subjectId:string; sessionId:string; version:unknown; nodeId:unknown; nodeVersion:unknown; policyVersion:unknown; epoch:string; expires:number }
/** Host-only, bounded in-memory handles. Restart drops handles and requires fresh issuance. */
export class SessionOperations implements ServiceHost {
  private readonly entries=new Map<string,Binding>();
  constructor(private readonly store:WorkflowStore,private readonly host:SessionOperationHost,private readonly capacity=1024) {
    if(!Number.isSafeInteger(capacity)||capacity<1) throw new ServiceError("INVALID_CONFIGURATION",500);
  }
  authenticate(token:string) { return this.host.authenticate(token); }
  now() { const n=this.host.now(); if(!Number.isSafeInteger(n)||n<0) throw new ServiceError("INTERNAL_ERROR",500); return n; }
  private async session(principal:Principal,id:string) {
    try { return await this.store.execute({tenantId:principal.tenantId,subjectId:principal.subjectId},{action:"getSession",sessionId:id},c=>this.host.authorize(structuredClone(principal),c)); }
    catch(e) { throw workflowError(e); }
  }
  private async binding(principal:Principal,session:Record<string,unknown>,expires:number):Promise<Binding> {
    const policy=await this.host.policyVersion(structuredClone(principal));
    if(!identifier(policy)) throw new ServiceError("INTERNAL_ERROR",500);
    if(session.status!=="running"||session.policyVersion!==policy) throw new ServiceError("STALE_OPERATION",409);
    return {tenantId:principal.tenantId,subjectId:principal.subjectId,sessionId:session.sessionId as string,version:session.version,nodeId:session.nodeId,nodeVersion:session.nodeVersion,policyVersion:policy,epoch:this.store.epoch,expires};
  }
  async issue(principal:Principal,sessionId:string,expires:number):Promise<string> {
    const now=this.now();
    if(!Number.isSafeInteger(expires)||expires<=now) throw new ServiceError("STALE_OPERATION",409);
    const session=await this.session(principal,sessionId);
    if(expires>(session.expiresAt as number)) throw new ServiceError("INVALID_REQUEST",400);
    const entry=await this.binding(principal,session,expires);
    for(const [id,b] of this.entries) if(this.now()>=b.expires) this.entries.delete(id);
    if(this.entries.size>=this.capacity) throw new ServiceError("OPERATION_CAPACITY",503);
    const id=randomUUID();this.entries.set(id,entry);return id;
  }
  revoke(operationId:string):void { this.entries.delete(operationId); }
  async resolve(principal:Principal,id:string):Promise<OperationSnapshot|null> {
    const entry=this.entries.get(id);
    if(!entry||entry.tenantId!==principal.tenantId||entry.subjectId!==principal.subjectId) return null;
    const live=async()=>{
      if(this.entries.get(id)!==entry||this.now()>=entry.expires) throw new ServiceError("STALE_OPERATION",409);
      const session=await this.session(principal,entry.sessionId);
      if(canonicalJson(await this.binding(principal,session,entry.expires))!==canonicalJson(entry)) throw new ServiceError("STALE_OPERATION",409);
      return session;
    };
    const session=await live();
    // Resolve keys, evidence and capabilities anew, including revocation and external policy changes.
    const details=structuredClone(await this.host.snapshot(structuredClone(principal),validateJson(session) as Record<string,unknown>,id));
    await live();
    if(!Number.isSafeInteger(details.expires)||details.expires<=this.now()) throw new ServiceError("STALE_OPERATION",409);
    const required={"tenant-id":entry.tenantId,"operation-id":id,"policy-version":String(entry.policyVersion),"session-id":entry.sessionId,"session-version":String(entry.version),"node-id":String(entry.nodeId),"node-version":String(entry.nodeVersion)};
    return {...details,tenantId:entry.tenantId,subjectId:entry.subjectId,operationId:id,policyVersion:String(entry.policyVersion),expires:Math.min(details.expires,entry.expires),verification:{...details.verification,context:{...details.verification.context,...required},allowedAttributes:[...new Set([...details.verification.allowedAttributes,...Object.keys(required)])]}};
  }
}
