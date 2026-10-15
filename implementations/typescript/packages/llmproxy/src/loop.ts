// SPDX-License-Identifier: Apache-2.0
import { canonicalJson, record, type Envelope } from "@psp-cdl/core";
import { verifyEnvelope, type VerificationPolicy } from "@psp-cdl/core/crypto";
import { aggregateCapabilities, evaluateBatch, type PolicyInput } from "@psp-cdl/cdl";
import { SecurityService, ServiceError, identifier, type Principal } from "@psp-cdl/api-server";
import { WorkflowStore, OwnerCoordinator, StoreError, bounded, integer, MAX_STATE_BYTES, type OwnerReservation } from "@psp-cdl/api-server/persistence";
import { McpDispatchGate, DispatchError, bindingDigest, makeEmitter, byteLength, textBytes, scopeOf, type CapabilitySource, type Emit, type ObserveOptions } from "@psp-cdl/mcpproxy";

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
  /** Signed interpreter/application context. Preserve conditions for the LLM; do not select nodes here. */
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
/** Observable prompt metadata: digest and sizes only; the text travels only at inspect level. */
export function describePrompt(prompt:Envelope):Record<string,unknown> {
  const s=prompt.signature;
  return {digest:bindingDigest(prompt),textBytes:textBytes(prompt.data as string),version:s.version,trustLevel:s.trustLevel??2,timestamp:s.timestamp,expires:s.expires};
}
/** Stable failure code for any error escaping the loop; identical mapping in both languages. */
export function loopCode(e:unknown):string {
  if(e instanceof LoopError||e instanceof DispatchError) return e.code;
  if(e instanceof ServiceError&&["UNAUTHENTICATED","FORBIDDEN"].includes(e.code)) return e.code;
  if(e instanceof StoreError&&["NOT_FOUND","EXPIRED","STATE_BUSY"].includes(e.code)) return e.code;
  return "HOST_ERROR";
}

/** Provider/tool transport and boundary enforcement. PSP execution belongs to the LLM context. */
export class BufferedLlmLoop {
  private readonly auth:SecurityService;
  protected readonly coordinator:OwnerCoordinator;
  protected readonly provider:ProviderRegistration;
  private readonly providerCaps:string[];
  protected readonly observe:ObserveOptions|undefined;
  protected readonly emit:Emit;
  constructor(protected readonly store:WorkflowStore,protected readonly gate:McpDispatchGate,protected readonly host:LoopHost,provider:ProviderRegistration,observe?:ObserveOptions) {
    if(!(store.coordinator instanceof OwnerCoordinator)||!(gate instanceof McpDispatchGate)||!gate.usesStore(store)||
      [host.authenticate,host.now,host.snapshot,host.prompt,host.verification,host.policy,host.authorizeFinal].some(f=>typeof f!=="function")||!record(provider)) fail("INVALID_CONFIGURATION");
    const {invoke,...metadata}=provider, meta=copy(metadata,"INVALID_CONFIGURATION");
    if(Object.keys(meta).sort().join(",")!=="complete,id,revision,sources"||!identifier(meta.id)||!identifier(meta.revision)||typeof invoke!=="function") fail("INVALID_CONFIGURATION");
    this.emit=makeEmitter("llmproxy",observe,fail);this.observe=observe;
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
    const policy=await callback(()=>this.host.verification(copy(p),copy(binding))),context=this.verificationContext(binding);
    try {
      if(!policy||!Array.isArray(policy.keys)||policy.keys.some(k=>k.allowUnscoped!==false)) fail("PROMPT_REJECTED");
      const e=verifyEnvelope(prompt,{...policy,context,allowedAttributes:[...Object.keys(context),...this.promptAttributes()],now:this.host.now()});
      if(e.signature.sectionType!=="system"||e.signature.contentType!=="text"||![1,2].includes(e.signature.trustLevel??2)) fail("PROMPT_REJECTED");
    }catch{return fail("PROMPT_REJECTED");}
  }
  protected verificationContext(binding:Record<string,unknown>):Record<string,string> {return promptContext(binding);}
  protected promptAttributes():string[] {return [];}
  protected async contextMessages():Promise<Record<string,unknown>[]> {return [];}
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
    const verdict=evaluateBatch(inputs);
    this.emit("cdl.decision",scopeOf(binding),{phase,decision:verdict.decision,reasonCodes:verdict.reasonCodes,resourceCount:inputs.length});
    if(verdict.decision==="unsupported") fail("UNSUPPORTED_POLICY");
    if(verdict.decision!=="allow") fail(phase==="release"?"OUTPUT_DENIED":"POLICY_DENIED");
    return context;
  }
  async run(token:unknown,sessionId:string,request:unknown,options:LoopOptions):Promise<Record<string,unknown>> {
    try {
      const input=copy(request);
      if(!record(input)||Object.keys(input).join(",")!=="message"||typeof input.message!=="string"||!identifier(sessionId)||
        !options||!integer(options.deadline)||typeof options.cancelled!=="function"||!integer(options.maxSteps)||options.maxSteps<1||options.maxSteps>32) fail("INVALID_REQUEST");
      options={deadline:options.deadline,cancelled:options.cancelled,maxSteps:options.maxSteps};
      const p=await this.principal(token),actor={tenantId:p.tenantId,subjectId:p.subjectId},turn=scopeOf({sessionId});
      this.check(options);
      this.emit("turn.start",turn,{inputBytes:textBytes(input.message),maxSteps:options.maxSteps,deadline:options.deadline,providerId:this.provider.id,providerRevision:this.provider.revision},()=>({message:input.message}));
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
      this.emit("session.loaded",turn,{sessionVersion:session.version,nodeId:session.nodeId,nodeVersion:session.nodeVersion,policyVersion:authority.policyVersion,authorityRevision:authority.revision,registryRevision:authority.registryRevision,expires,stateBytes:byteLength(session.state)},()=>({state:session.state}));
      this.emit("prompt.loaded",turn,describePrompt(prompt),()=>({text:prompt.data}));
      const fresh=async(checkPrompt=true)=>{
        this.check(options,expires);
        await this.principal(token,p);
        if(canonicalJson(await this.store.execute(actor,{action:"getSession",sessionId}))!==canonicalJson(session)) fail("STALE_SESSION");
        if(canonicalJson(await this.snapshot(p,session))!==canonicalJson(authority)) fail("STALE_AUTHORITY");
        if(checkPrompt)await this.verify(p,binding,prompt);
        this.check(options,expires);
      };
      const tools=await this.gate.listTools(token,sessionId,options,p);
      this.emit("tools.listed",turn,{count:tools.length,names:tools.map(t=>t.name)});
      const messages:Record<string,unknown>[]=[{role:"system",content:prompt.data},...copy(await this.contextMessages()),{role:"user",content:input.message}];
      for(let step=1;step<=options.maxSteps;step++) {
        let stepBinding:Record<string,unknown>;
        const at=scopeOf({sessionId,step});
        this.emit("step.start",at,{step});
        const result=await this.coordinator.runReserved(actor,async reservation=>{
          await fresh(false);
          const before=bindingDigest(prompt);
          prompt=await this.inferencePrompt(p,binding,prompt,options,reservation);
          if(bindingDigest(prompt)!==before)this.emit("prompt.replaced",at,describePrompt(prompt),()=>({text:prompt.data}));
          messages[0]={role:"system",content:prompt.data};
          stepBinding={...binding,step,promptDigest:bindingDigest(prompt)};
          await fresh();
          const providerRequest=copy({messages,tools});
          this.emit("prompt.assembled",at,{messageCount:messages.length,bytes:byteLength(providerRequest),toolCount:tools.length,promptDigest:stepBinding.promptDigest},()=>({messages}));
          await this.decide(p,stepBinding,{request:providerRequest},"inference",this.providerCaps);
          await fresh();
          this.emit("inference.start",at,{bytes:byteLength(providerRequest),messageCount:messages.length});
          let raw:unknown;
          try {raw=await this.provider.invoke(copy(providerRequest),{deadline:options.deadline,cancelled:options.cancelled});}
          catch {this.emit("inference.end",at,{ok:false});this.check(options,expires);return fail("PROVIDER_FAILED");}
          this.emit("inference.end",at,{ok:true});
          this.check(options,expires);
          const candidate=copy(raw,"INVALID_RESPONSE");
          if(!record(candidate)) fail("INVALID_RESPONSE");
          this.emit("model.candidate",at,{type:candidate.type==="tool"?"tool":candidate.type==="final"?"final":"invalid",toolName:typeof candidate.name==="string"?candidate.name:null,textBytes:typeof candidate.text==="string"?textBytes(candidate.text):null},()=>({candidate}));
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
          const outputDigest=bindingDigest({text:candidate.text});
          this.emit("final.authorized",at,{step,outputDigest,textBytes:textBytes(candidate.text)},()=>({text:candidate.text}));
          await fresh();
          return {output:{text:candidate.text,provenance:{profile:LLM_LOOP_PROFILE,providerId:this.provider.id,providerRevision:this.provider.revision,
            outputDigest,trustLevel:5,steps:step}}};
        });
        if(result.output) {this.emit("turn.buffered",turn,{steps:step,outputDigest:result.output.provenance.outputDigest});return result.output;}
        const candidate=result.candidate!;
        this.emit("dispatch.requested",at,{step,toolName:candidate.name,argumentBytes:byteLength(candidate.arguments)},()=>({arguments:candidate.arguments}));
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
        this.emit("transcript.grew",at,{messageCount:messages.length,bytes:byteLength({messages,tools}),toolName:candidate.name,dataBytes:byteLength(output.data),limit:MAX_STATE_BYTES},()=>({data:output.data}));
        copy({messages,tools}); // Bound the accumulated transcript before its next use.
      }
      return fail("STEP_LIMIT");
    }catch(e) {
      const code=loopCode(e);
      this.emit("turn.failed",scopeOf({sessionId}),{code});
      if(e instanceof LoopError) throw e;
      return fail(code);
    }
  }
}
