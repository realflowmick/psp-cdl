// SPDX-License-Identifier: Apache-2.0
import { PspError, byteLength, canonicalJson, parseMarkup, record, sectionToEnvelope, validateJson } from "@psp-cdl/core";
import { verifyEnvelope, type VerificationPolicy } from "@psp-cdl/core/crypto";
import { evaluateBatch, type PolicyInput } from "@psp-cdl/cdl";

export const SERVICE_PROFILE = "PSP-SERVICE-0.1";
export const MAX_REQUEST_BYTES = 1_048_576;
export type Operation = "verify" | "evaluate" | "createSession" | "getSession" | "updateSession" | "getNode" | "createCheckpoint" | "resumeCheckpoint";
export interface Principal { tenantId:string; subjectId:string; scopes:string[] }
export interface OperationSnapshot {
  tenantId:string; subjectId:string; operationId:string; policyVersion:string; expires:number;
  verification:Omit<VerificationPolicy,"now">;
  resources:PolicyInput[];
}
export interface ServiceHost {
  authenticate(token:string):Principal|null|Promise<Principal|null>;
  resolve(principal:Principal, operationId:string):OperationSnapshot|null|Promise<OperationSnapshot|null>;
  now():number;
}
export class ServiceError extends Error {
  constructor(public readonly code:string, public readonly status:number) { super(code); this.name="ServiceError"; }
}
export const scopeFor = (operation:Operation) => ({verify:"security:verify",evaluate:"policy:evaluate",createSession:"sessions:write",getSession:"sessions:read",updateSession:"sessions:write",getNode:"nodes:read",createCheckpoint:"checkpoints:write",resumeCheckpoint:"checkpoints:resume"})[operation];
export function identifier(value:unknown):value is string {
  return typeof value==="string" && value.length<=128 && /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value) && !/[^A-Za-z0-9._:-]/.test(value);
}
export function requestObject(value:unknown, fields:string[]):Record<string,unknown> {
  let input:unknown;
  try { input=validateJson(value); if(byteLength(canonicalJson(input))>MAX_REQUEST_BYTES) throw new ServiceError("REQUEST_TOO_LARGE",413); }
  catch(e) { if(e instanceof ServiceError) throw e; throw new ServiceError("INVALID_REQUEST",400); }
  if(!record(input)||Object.keys(input).some(k=>!fields.includes(k))||fields.some(k=>!Object.hasOwn(input,k))||!identifier(input.operation_id)) throw new ServiceError("INVALID_REQUEST",400);
  return input;
}
/** Host callbacks are the authority boundary. No model-supplied facts are accepted. */
export class SecurityService {
  readonly operations:readonly Operation[] = ["verify","evaluate"];
  constructor(private readonly host:ServiceHost) {}
  async authenticate(token:unknown):Promise<Principal> {
    if(typeof token!=="string"||token.length<1||token.length>4096||/[^\x21-\x7e]/.test(token)) throw new ServiceError("UNAUTHENTICATED",401);
    let p:unknown;
    try { p=validateJson(await this.host.authenticate(token)); } catch { throw new ServiceError("INTERNAL_ERROR",500); }
    if(p===null) throw new ServiceError("UNAUTHENTICATED",401);
    if(!record(p)||!identifier(p.tenantId)||!identifier(p.subjectId)||!Array.isArray(p.scopes)||p.scopes.some(s=>typeof s!=="string")) throw new ServiceError("INTERNAL_ERROR",500);
    return p as unknown as Principal;
  }
  async invoke(operation:Operation, value:unknown, token:unknown, expectedIdentity?:Principal):Promise<Record<string,unknown>> {
    const principal=await this.authenticate(token);
    if(expectedIdentity&&(principal.tenantId!==expectedIdentity.tenantId||principal.subjectId!==expectedIdentity.subjectId)) throw new ServiceError("FORBIDDEN",403);
    if(!["verify","evaluate"].includes(operation)) throw new ServiceError("UNSUPPORTED_OPERATION",404);
    if(!principal.scopes.includes(scopeFor(operation))) throw new ServiceError("FORBIDDEN",403);
    const input=requestObject(value,operation==="verify"?["operation_id","sections"]:["operation_id"]);
    const sections=operation==="verify"?input.sections:[];
    if(!Array.isArray(sections)||sections.length>32||(operation==="verify"&&!sections.length)) throw new ServiceError("INVALID_REQUEST",400);
    const ids=new Set<string>();
    for(const s of sections) {
      if(!record(s)||Object.keys(s).length!==2||!identifier(s.id)||typeof s.content!=="string"||ids.has(s.id)) throw new ServiceError("INVALID_REQUEST",400);
      ids.add(s.id);
    }
    let snapshot:OperationSnapshot|null;
    try { snapshot=await this.host.resolve(principal,input.operation_id as string); } catch(e) { if(e instanceof ServiceError) throw e; throw new ServiceError("INTERNAL_ERROR",500); }
    if(!snapshot||snapshot.tenantId!==principal.tenantId||snapshot.subjectId!==principal.subjectId||snapshot.operationId!==input.operation_id) throw new ServiceError("NOT_FOUND",404);
    const now=this.host.now();
    if(!Number.isFinite(now)||Math.abs(now)>Number.MAX_SAFE_INTEGER||!Number.isSafeInteger(snapshot.expires)||snapshot.expires<0||!identifier(snapshot.policyVersion)) throw new ServiceError("INTERNAL_ERROR",500);
    if(now>=snapshot.expires) throw new ServiceError("STALE_OPERATION",409);
    const common={profile:SERVICE_PROFILE,operation_id:input.operation_id,policy_version:snapshot.policyVersion};
    if(operation==="evaluate") {
      const decision=evaluateBatch(snapshot.resources);
      return {...common,...decision};
    }
    const policy=snapshot.verification;
    // Bind signatures to the same host-owned operation and policy revision.
    const required={"tenant-id":principal.tenantId,"operation-id":snapshot.operationId,"policy-version":snapshot.policyVersion};
    if(!policy||!record(policy.context)||Object.entries(required).some(([k,v])=>policy.context[k]!==v)||!Array.isArray(policy.keys)||policy.keys.some(k=>k.allowUnscoped!==false)) throw new ServiceError("INTERNAL_ERROR",500);
    const results=sections.map(s=>{
      const section=s as {id:string;content:string};
      try {
        const doc=parseMarkup(section.content);
        if(doc.children.length!==1||doc.children[0]?.kind!=="section") throw new PspError("INVALID_SECTION");
        const e=verifyEnvelope(sectionToEnvelope(doc.children[0]),{...policy,now});
        return {id:section.id,valid:true,signature_algorithm:e.signature.algorithm,trust_level:e.signature.trustLevel??2,priority:e.signature.priority??50,expires:e.signature.expires};
      } catch(e) {
        if(!(e instanceof PspError)) throw new ServiceError("INTERNAL_ERROR",500);
        return {id:section.id,valid:false,error:e.code};
      }
    });
    const valid=results.filter(r=>r.valid).length;
    return {...common,results,summary:{total:results.length,valid,invalid:results.length-valid}};
  }
}
