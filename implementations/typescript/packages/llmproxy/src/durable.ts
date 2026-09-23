// SPDX-License-Identifier: Apache-2.0
import {canonicalJson,record,type Envelope} from "@psp-cdl/core";
import {aggregateCapabilities,evaluateBatch,type PolicyInput} from "@psp-cdl/cdl";
import {SecurityService,ServiceError,identifier,type Principal} from "@psp-cdl/api-server";
import {WorkflowStore,StoreError,bounded,integer,type AccessContext} from "@psp-cdl/api-server/persistence";
import {McpDispatchGate,bindingDigest} from "@psp-cdl/mcpproxy";
import {BufferedLlmLoop,LoopError,type LoopHost,type LoopOptions,type ProviderRegistration} from "./loop.js";

export const DURABLE_LOOP_PROFILE="PSP-LLM-DURABLE-0.1";
export interface TurnPlan {state:Record<string,unknown>;retained:Record<string,unknown>;complete:boolean}
export interface DurableOptions extends LoopOptions {requestId:string;expectedVersion:number}
export type RecoveryOptions=Pick<LoopOptions,"deadline"|"cancelled">;
export interface DurableHost extends LoopHost {
  planTurn(principal:Principal,binding:Record<string,unknown>,data:Record<string,unknown>):TurnPlan|Promise<TurnPlan>;
  authorizeTransition(principal:Principal,context:AccessContext):boolean|Promise<boolean>;
  audit(principal:Principal,event:Record<string,unknown>):boolean|Promise<boolean>;
  authorizeRecovery(principal:Principal,binding:Record<string,unknown>,receipt:Record<string,unknown>):boolean|Promise<boolean>;
  recoveryPolicy(principal:Principal,binding:Record<string,unknown>,receipt:Record<string,unknown>):
    {bindingDigest:string;resources:PolicyInput[]}|Promise<{bindingDigest:string;resources:PolicyInput[]}>;
}
export class LockdownError extends LoopError {
  constructor(public readonly response:Record<string,unknown>) {super("PSP_POST_COMPLETION_LOCKDOWN");}
}
const fail=(code:string):never=>{throw new LoopError(code);};
function copy(v:unknown,code="INVALID_REQUEST"):any {try{return bounded(v);}catch{return fail(code);}}
async function call<T>(fn:()=>T|Promise<T>,code="HOST_ERROR"):Promise<T> {try{return await fn();}catch{return fail(code);}}
const same=(a:unknown,b:unknown)=>canonicalJson(a)===canonicalJson(b);
const actor=(p:Principal)=>({tenantId:p.tenantId,subjectId:p.subjectId});

/** Durable wrapper. A committed receipt is never an implicit permission to release it again. */
export class DurableLlmLoop extends BufferedLlmLoop {
  protected get completionPolicy():string {return "lockdown";}
  protected async prepareCommit(_p:Principal,_binding:Record<string,unknown>,command:Record<string,unknown>,_options:DurableOptions):Promise<Record<string,unknown>> {return command;}
  protected async authorizeCommit(p:Principal,_binding:Record<string,unknown>,context:AccessContext,_options:DurableOptions):Promise<void> {
    if(await call(()=>this.durableHost.authorizeTransition(copy(p),copy(context)))!==true)fail("TRANSITION_DENIED");
  }
  protected makeBuffered(host:LoopHost,_onPrompt:(prompt:Envelope)=>void,_token:unknown,_session:Record<string,unknown>,_options:DurableOptions):BufferedLlmLoop {return new BufferedLlmLoop(this.store,this.gate,host,this.provider);}
  protected turnCommand(command:Record<string,unknown>,_buffered:BufferedLlmLoop):Record<string,unknown> {return command;}
  constructor(store:WorkflowStore,gate:McpDispatchGate,private readonly durableHost:DurableHost,provider:ProviderRegistration,configuration:{postCompletion:"lockdown"}) {
    super(store,gate,durableHost,provider);
    if(!store.durableTurns||[durableHost.planTurn,durableHost.authorizeTransition,durableHost.audit,durableHost.authorizeRecovery,durableHost.recoveryPolicy].some(f=>typeof f!=="function")) fail("INVALID_CONFIGURATION");
    if(!record(configuration)||Object.keys(configuration).join(",")!=="postCompletion"||configuration.postCompletion!=="lockdown") fail("UNSUPPORTED_POST_COMPLETION");
  }
  protected async identity(token:unknown,scope:string,expected?:Principal):Promise<Principal> {
    const auth=new SecurityService({authenticate:t=>this.host.authenticate(t),now:()=>this.host.now(),resolve:()=>null});
    const p=await auth.authenticate(token);
    if(!p.scopes.includes(scope)||expected&&(p.tenantId!==expected.tenantId||p.subjectId!==expected.subjectId)) fail("FORBIDDEN");
    if(scope==="sessions:write"&&!p.scopes.includes("models:invoke")) fail("FORBIDDEN");
    return p;
  }
  protected async boundary<T>(fn:()=>Promise<T>):Promise<T> {
    try{return await fn();}catch(e){
      if(e instanceof LoopError) throw e;
      if(e instanceof ServiceError&&["UNAUTHENTICATED","FORBIDDEN"].includes(e.code)) return fail(e.code);
      if(e instanceof StoreError&&["NOT_FOUND","EXPIRED","STATE_BUSY","STATE_CONFLICT","IDEMPOTENCY_CONFLICT","PERSISTENCE_DENIED","AUTHORIZATION_DENIED","INVALID_STATE","INVALID_TRANSITION","STORE_BUSY"].includes(e.code)) return fail(e.code);
      return fail("HOST_ERROR");
    }
  }
  protected controls(options:RecoveryOptions):RecoveryOptions {
    if(!options||!integer(options.deadline)||typeof options.cancelled!=="function") fail("INVALID_REQUEST");
    return {deadline:options.deadline,cancelled:options.cancelled};
  }
  protected present(receipt:Record<string,unknown>,recovered:boolean):Record<string,unknown> {
    return {...copy(receipt.output),receipt:{profile:DURABLE_LOOP_PROFILE,requestId:receipt.requestId,sessionVersion:receipt.sessionVersion,status:receipt.status,recovered}};
  }
  override async run(token:unknown,sessionId:string,request:unknown,options:DurableOptions):Promise<Record<string,unknown>> {
    return this.boundary(async()=>{
      const input=copy(request),controls=this.controls(options);
      if(!record(input)||Object.keys(input).join(",")!=="message"||typeof input.message!=="string"||!identifier(sessionId)||!identifier(options.requestId)||!integer(options.expectedVersion)||options.expectedVersion<1||!integer(options.maxSteps)||options.maxSteps<1||options.maxSteps>32) fail("INVALID_REQUEST");
      options={...controls,maxSteps:options.maxSteps,requestId:options.requestId,expectedVersion:options.expectedVersion};
      const p=await this.identity(token,"sessions:write"),owner=actor(p),inputDigest=bindingDigest(input);
      this.check(controls);
      const session=await this.coordinator.run(owner,async()=>{
        const s=await this.store.execute(owner,{action:"getSession",sessionId});
        if(s.status==="completed"&&record(s.llmCompletion)&&s.llmCompletion.profile===DURABLE_LOOP_PROFILE&&s.llmCompletion.policy==="lockdown") {
          const lockedAt=s.llmCompletion.lockedAt;
          if(!integer(lockedAt)||lockedAt>253402300799) fail("INVALID_STATE");
          if(await call(()=>this.durableHost.audit(copy(p),{signal:"post_completion_override_attempt",sessionId,inputDigest,at:this.host.now()}),"AUDIT_FAILED")!==true) fail("AUDIT_FAILED");
          throw new LockdownError({error:"session_locked",code:"PSP_POST_COMPLETION_LOCKDOWN",message:"This session has concluded. No further interaction is permitted.",session_id:sessionId,locked_at:new Date((lockedAt as number)*1000).toISOString().replace(".000Z","Z"),policy:"lockdown"});
        }
        if(s.status!=="running") fail("INACTIVE_SESSION");
        let old:Record<string,unknown>|undefined;
        try{old=await this.store.execute(owner,{action:"getTurn",sessionId,requestId:options.requestId});}catch(e){if(!(e instanceof StoreError&&e.code==="NOT_FOUND"))throw e;}
        if(old) fail(old.inputDigest===inputDigest&&old.sessionVersion===options.expectedVersion+1?"TURN_ALREADY_COMMITTED":"IDEMPOTENCY_CONFLICT");
        if(s.version!==options.expectedVersion) fail("STALE_SESSION");
        return s;
      });
      const authority=await this.snapshot(p,session),expires=Math.min(authority.expires,session.expiresAt as number);
      this.check(controls,expires);
      let prompt:Envelope|undefined,plan:TurnPlan|undefined,binding:Record<string,unknown>|undefined,data:Record<string,unknown>|undefined,planError:unknown;
      const wrapped:LoopHost={
        authenticate:t=>this.host.authenticate(t),now:()=>this.host.now(),
        snapshot:async(live,s)=>{try{if(!same(s,session))fail("STALE_SESSION");const a=await this.host.snapshot(live,s);if(!same(a,authority))fail("STALE_AUTHORITY");return a;}catch(e){planError=e;throw e;}},
        prompt:async(live,b)=>{prompt=copy(await this.host.prompt(live,b),"PROMPT_REJECTED");return prompt!;},
        verification:(live,b)=>this.host.verification(live,b),policy:(live,b,d,phase)=>this.host.policy(live,b,d,phase),
        authorizeFinal:async(live,b,d)=>{
          try {
            if(await call(()=>this.host.authorizeFinal(copy(live),copy(b),copy(d)))!==true) return false;
            const proposed=copy(await call(()=>this.durableHost.planTurn(copy(live),copy({...b,requestId:options.requestId,postCompletion:this.completionPolicy}),copy(d))),"INVALID_PLAN");
            if(!record(proposed)||Object.keys(proposed).sort().join(",")!=="complete,retained,state"||!record(proposed.state)||!record(proposed.retained)||typeof proposed.complete!=="boolean") fail("INVALID_PLAN");
            plan=proposed as unknown as TurnPlan;binding=copy(b);data=copy(d);return true;
          }catch(e){planError=e;return false;}
        }
      };
      let output:Record<string,unknown>;
      const buffered=this.makeBuffered(wrapped,value=>{prompt=copy(value);},token,session,options);
      try{output=await buffered.run(token,sessionId,input,options);}catch(e){throw planError??e;}
      if(!plan||!binding||!data||!prompt) return fail("INVALID_PLAN");
      const fresh=async(committedVersion?:unknown)=>{
        this.check(controls,expires);
        const live=await this.identity(token,"sessions:write",p),s=await this.store.execute(owner,{action:"getSession",sessionId});
        if(committedVersion===undefined?!same(s,session):s.version!==committedVersion) fail("STALE_SESSION");
        if(!same(await this.snapshot(live,s),authority)) fail("STALE_AUTHORITY");
        await this.verify(live,binding!,prompt!);this.check(controls,expires);
      };
      let guardError:unknown;
      const command=await this.prepareCommit(p,binding,this.turnCommand({action:"commitTurn",requestId:options.requestId,sessionId,expectedVersion:options.expectedVersion,nodeId:session.nodeId,nodeVersion:session.nodeVersion,policyVersion:session.policyVersion,
        state:plan.state,retained:plan.retained,complete:plan.complete,postCompletion:this.completionPolicy,inputDigest,output},buffered),options);
      const receipt=await this.store.execute(owner,command,async context=>{
        try {
          if(context.replay) fail("TURN_ALREADY_COMMITTED");
          await fresh();
          await this.authorizeCommit(p,binding!,context,options);
          await fresh();return true;
        }catch(e){guardError=e;return false;}
      }).catch(e=>{throw guardError??e;});
      return this.coordinator.run(owner,async()=>{
        await fresh(receipt.sessionVersion);
        await this.decide(p,{...binding,committedVersion:receipt.sessionVersion},data!,"release",aggregateCapabilities(authority.releaseSources,authority.releaseComplete));
        await fresh(receipt.sessionVersion);
        return this.present(receipt,false);
      });
    });
  }
  async recover(token:unknown,sessionId:string,requestId:string,options:RecoveryOptions):Promise<Record<string,unknown>> {
    return this.boundary(async()=>{
      const controls=this.controls(options);
      if(!identifier(sessionId)||!identifier(requestId)) fail("INVALID_REQUEST");
      const p=await this.identity(token,"sessions:read"),owner=actor(p);this.check(controls);
      return this.coordinator.run(owner,async()=>{
        const session=await this.store.execute(owner,{action:"getSession",sessionId});
        const receipt=await this.store.execute(owner,{action:"getTurn",sessionId,requestId});
        const authority=await this.snapshot(p,session),expires=Math.min(authority.expires,session.expiresAt as number);
        this.check(controls,expires);
        const context={...owner,sessionId,sessionVersion:session.version,epoch:this.store.epoch,policyVersion:authority.policyVersion,authorityRevision:authority.revision,
          phase:"recovery",requestId,receiptDigest:bindingDigest(receipt),deadline:controls.deadline};
        const fresh=async()=>{
          const live=await this.identity(token,"sessions:read",p);
          if(!same(await this.store.execute(owner,{action:"getSession",sessionId}),session)) fail("STALE_SESSION");
          if(!same(await this.snapshot(live,session),authority)) fail("STALE_AUTHORITY");
          this.check(controls,expires);
        };
        if(await call(()=>this.durableHost.authorizeRecovery(copy(p),copy(context),copy(receipt)))!==true) fail("RECOVERY_DENIED");
        const policy=copy(await call(()=>this.durableHost.recoveryPolicy(copy(p),copy(context),copy(receipt))),"INVALID_POLICY");
        if(!record(policy)||Object.keys(policy).sort().join(",")!=="bindingDigest,resources"||policy.bindingDigest!==bindingDigest(context)||!Array.isArray(policy.resources)||!policy.resources.length) fail("INVALID_POLICY");
        const capabilities=aggregateCapabilities(authority.releaseSources,authority.releaseComplete);
        const resources=policy.resources.map((r:PolicyInput)=>{if(!record(r))return fail("INVALID_POLICY");return {...r,capabilities:aggregateCapabilities([{id:"recipient",capabilities},{id:"path",capabilities:r.capabilities}],true)};});
        const decision=evaluateBatch(resources).decision;
        if(decision==="unsupported") fail("UNSUPPORTED_POLICY");
        if(decision!=="allow") fail("OUTPUT_DENIED");
        await fresh();return this.present(receipt,true);
      });
    });
  }
}
