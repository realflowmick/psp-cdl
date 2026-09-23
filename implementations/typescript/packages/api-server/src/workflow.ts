// SPDX-License-Identifier: Apache-2.0
import { record, validateJson, canonicalJson, byteLength } from "@psp-cdl/core";
import { WorkflowStore, StoreError, type AccessContext } from "./persistence.js";
import { SecurityService, ServiceError, identifier, scopeFor, MAX_REQUEST_BYTES, type ServiceHost, type Principal, type Operation } from "./service.js";

export const WORKFLOW_SERVICE_PROFILE = "PSP-WORKFLOW-SERVICE-0.1";
export const workflowFields = {
  createSession:["requestId","nodeId","nodeVersion","expiresAt","state"],
  getSession:["sessionId"],
  updateSession:["requestId","sessionId","expectedVersion","nodeId","nodeVersion","status","state"],
  getNode:["nodeId","nodeVersion"],
  createCheckpoint:["requestId","sessionId","expectedVersion","expiresAt"],
  resumeCheckpoint:["requestId","checkpointId","state"]
} as const;
export type WorkflowOperation = keyof typeof workflowFields;
export interface WorkflowAuthority {
  policyVersion(principal:Principal):string|Promise<string>;
  authorize(principal:Principal, context:AccessContext):boolean|Promise<boolean>;
}
export interface WorkflowHost extends ServiceHost, WorkflowAuthority {
  /** Project only data that this caller may receive. No credentials or authority records. */
  present(principal:Principal, operation:WorkflowOperation, result:Record<string,unknown>):Record<string,unknown>|Promise<Record<string,unknown>>;
  /** Trusted side channel; repeated delivery of the same checkpoint must be safe. */
  deliverCheckpoint(principal:Principal, checkpoint:Record<string,unknown>):void|Promise<void>;
  resumeToken(principal:Principal, checkpointId:string):string|null|Promise<string|null>;
}
export function workflowError(error:unknown):ServiceError {
  if(error instanceof ServiceError) return error;
  if(error instanceof StoreError) {
    const code=error.code;
    const status=code==="NOT_FOUND"?404:["AUTHORIZATION_DENIED","PERSISTENCE_DENIED","INVALID_TOKEN"].includes(code)?403:
      ["INVALID_COMMAND","INVALID_STATE","INVALID_EXPIRY"].includes(code)?400:code==="STORE_BUSY"?503:
      ["STATE_BUSY","STATE_CONFLICT","NODE_CONFLICT","IDEMPOTENCY_CONFLICT","INVALID_TRANSITION","CHECKPOINT_CONSUMED","EXPIRED","CHECKPOINT_KEY_CHANGED","VERSION_EXHAUSTED"].includes(code)?409:500;
    return new ServiceError(status===500?"INTERNAL_ERROR":code,status);
  }
  return new ServiceError("INTERNAL_ERROR",500);
}
function request(operation:WorkflowOperation,value:unknown):Record<string,unknown> {
  let input:unknown;
  try { input=validateJson(value); } catch { throw new ServiceError("INVALID_REQUEST",400); }
  if(byteLength(canonicalJson(input))>MAX_REQUEST_BYTES) throw new ServiceError("REQUEST_TOO_LARGE",413);
  const fields:readonly string[]=workflowFields[operation];
  if(!record(input)||Object.keys(input).length!==fields.length||fields.some(k=>!Object.hasOwn(input,k))) throw new ServiceError("INVALID_REQUEST",400);
  for(const k of ["requestId","nodeId","nodeVersion"]) if(k in input&&!identifier(input[k])) throw new ServiceError("INVALID_REQUEST",400);
  for(const k of ["sessionId","checkpointId"]) if(k in input&&(typeof input[k]!=="string"||input[k].length!==36||!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(input[k] as string))) throw new ServiceError("INVALID_REQUEST",400);
  for(const k of ["expectedVersion","expiresAt"]) if(k in input&&(!Number.isSafeInteger(input[k])||(input[k] as number)<=0)) throw new ServiceError("INVALID_REQUEST",400);
  if(("state" in input&&!record(input.state))||("status" in input&&!["running","completed"].includes(input.status as string))) throw new ServiceError("INVALID_REQUEST",400);
  return input;
}
/** Opt-in authenticated workflow service. Node publication remains a host-only operation. */
export class WorkflowService extends SecurityService {
  override readonly operations:readonly Operation[] = ["verify","evaluate",...Object.keys(workflowFields) as WorkflowOperation[]];
  constructor(private readonly store:WorkflowStore, private readonly workflowHost:WorkflowHost) {
    super(workflowHost);
    if([workflowHost.authenticate,workflowHost.resolve,workflowHost.now,workflowHost.policyVersion,workflowHost.authorize,workflowHost.present,workflowHost.deliverCheckpoint,workflowHost.resumeToken].some(f=>typeof f!=="function")) throw new ServiceError("INVALID_CONFIGURATION",500);
  }
  override async invoke(operation:Operation,value:unknown,token:unknown,expectedIdentity?:Principal):Promise<Record<string,unknown>> {
    if(operation==="verify"||operation==="evaluate") return super.invoke(operation,value,token,expectedIdentity);
    try {
      const principal=await this.authenticate(token);
      const recheck=async()=>{
        const live=await this.authenticate(token);
        if(live.tenantId!==principal.tenantId||live.subjectId!==principal.subjectId||!live.scopes.includes(scopeFor(operation))) throw new ServiceError("FORBIDDEN",403);
        return live;
      };
      if(expectedIdentity&&(principal.tenantId!==expectedIdentity.tenantId||principal.subjectId!==expectedIdentity.subjectId)) throw new ServiceError("FORBIDDEN",403);
      if(!Object.hasOwn(workflowFields,operation)) throw new ServiceError("UNSUPPORTED_OPERATION",404);
      if(!principal.scopes.includes(scopeFor(operation))) throw new ServiceError("FORBIDDEN",403);
      const input=request(operation,value), command:Record<string,unknown>={action:operation,...input};
      if(operation==="createSession"||operation==="updateSession") {
        command.policyVersion=await this.workflowHost.policyVersion(validateJson(principal) as unknown as Principal);
        if(!identifier(command.policyVersion)) throw new ServiceError("INTERNAL_ERROR",500);
      }
      if(operation==="resumeCheckpoint") {
        command.resumeToken=await this.workflowHost.resumeToken(validateJson(principal) as unknown as Principal,input.checkpointId as string);
        if(typeof command.resumeToken!=="string") throw new ServiceError("FORBIDDEN",403);
      }
      const actor={tenantId:principal.tenantId,subjectId:principal.subjectId};
      const result=await this.store.execute(actor,command,async context=>{
        const live=await recheck();
        if(command.policyVersion!==undefined&&await this.workflowHost.policyVersion(validateJson(live) as unknown as Principal)!==command.policyVersion) return false;
        if(await this.workflowHost.authorize(validateJson(live) as unknown as Principal,context)!==true) return false;
        const final=await recheck();
        const requiredPolicy=command.policyVersion??(!context.replay&&["createCheckpoint","resumeCheckpoint"].includes(operation)?context.current?.policyVersion:undefined);
        return requiredPolicy===undefined||await this.workflowHost.policyVersion(validateJson(final) as unknown as Principal)===requiredPolicy;
      });
      const live=await recheck();
      if(operation==="createCheckpoint") {
        try { await this.workflowHost.deliverCheckpoint(validateJson(live) as unknown as Principal,validateJson(result) as Record<string,unknown>); }
        catch { throw new ServiceError("CHECKPOINT_DELIVERY_FAILED",503); }
        const {checkpointId,sessionId,sessionVersion,expiresAt}=result;
        return {profile:WORKFLOW_SERVICE_PROFILE,result:{checkpointId,sessionId,sessionVersion,expiresAt}};
      }
      // Never pass control records to model-facing projection callbacks. Select data only.
      const data=operation==="getNode"?result.definition:result.state;
      const view=validateJson(await this.workflowHost.present(validateJson(live) as unknown as Principal,operation,validateJson(data) as Record<string,unknown>));
      if(!record(view)) throw new ServiceError("INTERNAL_ERROR",500);
      const output=operation==="getNode"?{nodeId:result.nodeId,nodeVersion:result.nodeVersion,view}:
        {sessionId:result.sessionId,version:result.version,status:result.status,view};
      if(byteLength(canonicalJson(output))>MAX_REQUEST_BYTES) throw new ServiceError("RESPONSE_TOO_LARGE",500);
      await recheck();
      return {profile:WORKFLOW_SERVICE_PROFILE,result:output};
    } catch(error) { throw workflowError(error); }
  }
}
