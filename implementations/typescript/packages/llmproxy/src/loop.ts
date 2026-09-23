// SPDX-License-Identifier: Apache-2.0
import { canonicalJson, record, type Envelope } from "@psp-cdl/core";
import { verifyEnvelope, type VerificationPolicy } from "@psp-cdl/core/crypto";
import { aggregateCapabilities, evaluateBatch, type PolicyInput } from "@psp-cdl/cdl";
import { SecurityService, ServiceError, identifier, type Principal } from "@psp-cdl/api-server";
import { WorkflowStore, OwnerCoordinator, StoreError, bounded, integer,type OwnerReservation } from "@psp-cdl/api-server/persistence";
import { McpDispatchGate, DispatchError, bindingDigest, type CapabilitySource } from "@psp-cdl/mcpproxy";

export const LLM_LOOP_PROFILE="PSP-LLM-LOOP-0.1";
export class LoopError extends Error {
  constructor(public readonly code:string) {super(code);this.name="LoopError";}
}
export interface LoopOptions {deadline:number;cancelled:()=>boolean;maxSteps:number}
export interface ProviderRegistration {
  id:string;revision:string;sources:CapabilitySource[];complete:boolean;
  invoke(request:Record<string,unknown>,options:Pick<LoopOptions,"deadline"|"cancelled">):unknown|Promise<unknown>;
}
export interface LoopAuthority {
  revision:string;policyVersion:string;providerId:string;providerRevision:string;registryRevision:string;
  expires:number;releaseSources:CapabilitySource[];releaseComplete:boolean;
}
export type LoopPhase="inference"|"tool"|"release";
export interface LoopHost {
  authenticate(token:string):Principal|null|Promise<Principal|null>;
  now():number;
  snapshot(principal:Principal,session:Record<string,unknown>):LoopAuthority|Promise<LoopAuthority>;
  prompt(principal:Principal,binding:Record<string,unknown>):Envelope|Promise<Envelope>;
  verification(principal:Principal,binding:Record<string,unknown>):
    Pick<VerificationPolicy,"keys"|"clockSkew">|Promise<Pick<VerificationPolicy,"keys"|"clockSkew">>;
  policy(principal:Principal,binding:Record<string,unknown>,data:Record<string,unknown>,phase:LoopPhase):
    {bindingDigest:string;resources:PolicyInput[]}|Promise<{bindingDigest:string;resources:PolicyInput[]}>;
  authorizeFinal(principal:Principal,binding:Record<string,unknown>,data:Record<string,unknown>):boolean|Promise<boolean>;
}
const fail=(code:string):never=>{throw new LoopError(code);};
function copy(value:unknown,code="INVALID_REQUEST"):any {try{return bounded(value);}catch{return fail(code);}}
async function callback<T>(fn:()=>T|Promise<T>):Promise<T> {try{return await fn();}catch{return fail("HOST_ERROR");}}
function caps(sources:CapabilitySource[],complete:boolean):string[] {
  try{return aggregateCapabilities(sources,complete);}catch{return fail("INVALID_CAPABILITIES");}
}
/** Required signed attributes. The binding is host-only; do not put it in model messages. */
export function promptContext(binding:Record<string,unknown>):Record<string,string> {
  const fields={"tenant-id":"tenantId","subject-id":"subjectId","session-id":"sessionId","session-version":"sessionVersion",
    "node-id":"nodeId","node-version":"nodeVersion","store-epoch":"epoch","policy-version":"policyVersion",
    "authority-revision":"authorityRevision","provider-id":"providerId","provider-revision":"providerRevision","registry-revision":"registryRevision"};
  return Object.fromEntries(Object.entries(fields).map(([attribute,field])=>[attribute,String(binding[field])]));
}

/** Bounded, buffered, host-embedded loop. No listener, provider SDK or implicit credential lookup. */
export class BufferedLlmLoop {
  private readonly auth:SecurityService;
  protected readonly coordinator:OwnerCoordinator;
  protected readonly provider:ProviderRegistration;
  private readonly providerCaps:string[];
  constructor(protected readonly store:WorkflowStore,protected readonly gate:McpDispatchGate,protected readonly host:LoopHost,provider:ProviderRegistration) {
    if(!(store.coordinator instanceof OwnerCoordinator)||!(gate instanceof McpDispatchGate)||!gate.usesStore(store)||
      [host.authenticate,host.now,host.snapshot,host.prompt,host.verification,host.policy,host.authorizeFinal].some(f=>typeof f!=="function")||!record(provider)) fail("INVALID_CONFIGURATION");
    const {invoke,...metadata}=provider, meta=copy(metadata,"INVALID_CONFIGURATION");
    if(Object.keys(meta).sort().join(",")!=="complete,id,revision,sources"||!identifier(meta.id)||!identifier(meta.revision)||typeof invoke!=="function") fail("INVALID_CONFIGURATION");
    this.provider={...meta,invoke};this.providerCaps=caps(meta.sources,meta.complete);
    this.coordinator=store.coordinator!;
    this.auth=new SecurityService({authenticate:t=>host.authenticate(t),now:()=>host.now(),resolve:()=>null});
  }
  protected check(options:Pick<LoopOptions,"deadline"|"cancelled">,expires=Number.MAX_SAFE_INTEGER):void {
    const now=this.host.now(),cancelled=options.cancelled();
    if(!integer(now)||typeof cancelled!=="boolean") fail("HOST_ERROR");
    if(cancelled) fail("CANCELLED");
    if(now>=options.deadline) fail("DEADLINE_EXCEEDED");
    if(now>=expires) fail("STALE_AUTHORITY");
  }
  private async principal(token:unknown,expected?:Principal):Promise<Principal> {
    const p=await this.auth.authenticate(token);
    if(!p.scopes.includes("models:invoke")||expected&&(p.tenantId!==expected.tenantId||p.subjectId!==expected.subjectId)) fail("FORBIDDEN");
    return p;
  }
  protected async snapshot(p:Principal,s:Record<string,unknown>):Promise<LoopAuthority> {
    const a=copy(await callback(()=>this.host.snapshot(copy(p),copy(s))),"INVALID_AUTHORITY");
    if(!record(a)||Object.keys(a).sort().join(",")!=="expires,policyVersion,providerId,providerRevision,registryRevision,releaseComplete,releaseSources,revision"||
      !identifier(a.revision)||a.policyVersion!==s.policyVersion||a.providerId!==this.provider.id||a.providerRevision!==this.provider.revision||
      a.registryRevision!==this.gate.registryRevision||!integer(a.expires)) fail("STALE_AUTHORITY");
    caps(a.releaseSources as CapabilitySource[],a.releaseComplete as boolean);
    return a as unknown as LoopAuthority;
  }
  protected async verify(p:Principal,binding:Record<string,unknown>,prompt:Envelope):Promise<void> {
    const policy=await callback(()=>this.host.verification(copy(p),copy(binding))),context=promptContext(binding);
    try {
      if(!policy||!Array.isArray(policy.keys)||policy.keys.some(k=>k.allowUnscoped!==false)) fail("PROMPT_REJECTED");
      const e=verifyEnvelope(prompt,{...policy,context,allowedAttributes:[...Object.keys(context),...this.promptAttributes()],now:this.host.now()});
      if(e.signature.sectionType!=="system"||e.signature.contentType!=="text"||![1,2].includes(e.signature.trustLevel??2)) fail("PROMPT_REJECTED");
    }catch{return fail("PROMPT_REJECTED");}
  }
  protected promptAttributes():string[] {return [];}
  protected async loadPrompt(p:Principal,binding:Record<string,unknown>,_options:LoopOptions,_reservation:OwnerReservation):Promise<Envelope> {
    const prompt=copy(await callback(()=>this.host.prompt(copy(p),copy(binding))),"PROMPT_REJECTED") as Envelope;
    await this.verify(p,binding,prompt);return prompt;
  }
  protected async inferencePrompt(_p:Principal,_binding:Record<string,unknown>,prompt:Envelope,_options:LoopOptions,_reservation:OwnerReservation):Promise<Envelope> {return prompt;}
  protected async decide(p:Principal,binding:Record<string,unknown>,data:Record<string,unknown>,phase:LoopPhase,recipientCaps:string[]):Promise<Record<string,unknown>> {
    const context={...binding,phase,dataDigest:bindingDigest(data)};
    const policy=copy(await callback(()=>this.host.policy(copy(p),copy(context),copy(data),phase)),"INVALID_POLICY");
    if(!record(policy)||Object.keys(policy).sort().join(",")!=="bindingDigest,resources"||policy.bindingDigest!==bindingDigest(context)||!Array.isArray(policy.resources)||!policy.resources.length) fail("INVALID_POLICY");
    const inputs=(policy.resources as PolicyInput[]).map(r=>{
      if(!record(r)) return fail("INVALID_POLICY");
      return {...r,capabilities:caps([{id:"recipient",capabilities:recipientCaps},{id:"path",capabilities:r.capabilities}],true)};
    });
    const decision=evaluateBatch(inputs).decision;
    if(decision==="unsupported") fail("UNSUPPORTED_POLICY");
    if(decision!=="allow") fail(phase==="release"?"OUTPUT_DENIED":"POLICY_DENIED");
    return context;
  }
  async run(token:unknown,sessionId:string,request:unknown,options:LoopOptions):Promise<Record<string,unknown>> {
    try {
      const input=copy(request);
      if(!record(input)||Object.keys(input).join(",")!=="message"||typeof input.message!=="string"||!identifier(sessionId)||
        !options||!integer(options.deadline)||typeof options.cancelled!=="function"||!integer(options.maxSteps)||options.maxSteps<1||options.maxSteps>32) fail("INVALID_REQUEST");
      options={deadline:options.deadline,cancelled:options.cancelled,maxSteps:options.maxSteps};
      const p=await this.principal(token),actor={tenantId:p.tenantId,subjectId:p.subjectId};
      this.check(options);
      const initial=await this.coordinator.runReserved(actor,async reservation=>{
        const session=await this.store.execute(actor,{action:"getSession",sessionId});
        if(session.status!=="running") fail("INACTIVE_SESSION");
        const authority=await this.snapshot(p,session);
        this.check(options,Math.min(authority.expires,session.expiresAt as number));
        const binding={tenantId:p.tenantId,subjectId:p.subjectId,sessionId,sessionVersion:session.version,nodeId:session.nodeId,nodeVersion:session.nodeVersion,
          epoch:this.store.epoch,policyVersion:authority.policyVersion,authorityRevision:authority.revision,providerId:this.provider.id,providerRevision:this.provider.revision,
          registryRevision:authority.registryRevision,deadline:options.deadline};
        const prompt=await this.loadPrompt(p,binding,options,reservation);
        return {session,authority,binding,prompt};
      });
      const {session,authority,binding}=initial,expires=Math.min(authority.expires,session.expiresAt as number);
      let prompt=initial.prompt;
      const fresh=async(checkPrompt=true)=>{
        this.check(options,expires);
        await this.principal(token,p);
        if(canonicalJson(await this.store.execute(actor,{action:"getSession",sessionId}))!==canonicalJson(session)) fail("STALE_SESSION");
        if(canonicalJson(await this.snapshot(p,session))!==canonicalJson(authority)) fail("STALE_AUTHORITY");
        if(checkPrompt)await this.verify(p,binding,prompt);
        this.check(options,expires);
      };
      const tools=await this.gate.listTools(token,sessionId,options,p);
      const messages:Record<string,unknown>[]=[{role:"system",content:prompt.data},{role:"user",content:input.message}];
      for(let step=1;step<=options.maxSteps;step++) {
        let stepBinding:Record<string,unknown>;
        const result=await this.coordinator.runReserved(actor,async reservation=>{
          await fresh(false);
          prompt=await this.inferencePrompt(p,binding,prompt,options,reservation);
          messages[0]={role:"system",content:prompt.data};
          stepBinding={...binding,step,promptDigest:bindingDigest(prompt)};
          await fresh();
          const providerRequest=copy({messages,tools});
          await this.decide(p,stepBinding,{request:providerRequest},"inference",this.providerCaps);
          await fresh();
          let raw:unknown;
          try {raw=await this.provider.invoke(copy(providerRequest),{deadline:options.deadline,cancelled:options.cancelled});}
          catch {this.check(options,expires);return fail("PROVIDER_FAILED");}
          this.check(options,expires);
          const candidate=copy(raw,"INVALID_RESPONSE");
          if(!record(candidate)) fail("INVALID_RESPONSE");
          if(candidate.type==="tool") {
            if(Object.keys(candidate).sort().join(",")!=="arguments,name,type"||typeof candidate.name!=="string"||!record(candidate.arguments)) fail("INVALID_RESPONSE");
            if(!tools.some(t=>t.name===candidate.name)) fail("TOOL_NOT_ALLOWED");
            if(step===options.maxSteps) fail("STEP_LIMIT");
            await fresh();return {candidate};
          }
          if(candidate.type!=="final"||Object.keys(candidate).sort().join(",")!=="text,type"||typeof candidate.text!=="string") fail("INVALID_RESPONSE");
          const data=copy({request:providerRequest,candidate});
          const context=await this.decide(p,stepBinding,data,"release",caps(authority.releaseSources,authority.releaseComplete));
          if(await callback(()=>this.host.authorizeFinal(copy(p),copy(context),copy(data)))!==true) fail("COMPLETION_DENIED");
          await fresh();
          return {output:{text:candidate.text,provenance:{profile:LLM_LOOP_PROFILE,providerId:this.provider.id,providerRevision:this.provider.revision,
            outputDigest:bindingDigest({text:candidate.text}),trustLevel:5,steps:step}}};
        });
        if(result.output) return result.output;
        const candidate=result.candidate!;
        let guardError:unknown;
        const output=await this.gate.callTool(token,sessionId,{name:candidate.name,arguments:candidate.arguments},{...options,
          authorizeDispatch:async(current,recipientCaps)=>{
            try {
              if(canonicalJson(current)!==canonicalJson(session)) fail("STALE_SESSION");
              await fresh();
              await this.decide(p,stepBinding!,copy({request:{messages,tools},candidate}),"tool",recipientCaps);
              await fresh();return true;
            }catch(e){guardError=e;return false;}
          }
        },p).catch(e=>{throw guardError??e;});
        // A refresh must not make a result produced under an expired prompt usable.
        await this.coordinator.run(actor,()=>fresh());
        messages.push({role:"assistant",call:{name:candidate.name,arguments:candidate.arguments}},{role:"tool",name:candidate.name,data:output.data});
        copy({messages,tools}); // Bound the accumulated transcript before its next use.
      }
      return fail("STEP_LIMIT");
    }catch(e) {
      if(e instanceof LoopError) throw e;
      if(e instanceof DispatchError) return fail(e.code);
      if(e instanceof ServiceError&&["UNAUTHENTICATED","FORBIDDEN"].includes(e.code)) return fail(e.code);
      if(e instanceof StoreError&&["NOT_FOUND","EXPIRED","STATE_BUSY"].includes(e.code)) return fail(e.code);
      return fail("HOST_ERROR");
    }
  }
}
