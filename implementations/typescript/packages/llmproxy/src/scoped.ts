// SPDX-License-Identifier: Apache-2.0
import {record,type Envelope} from "@psp-cdl/core";
import {aggregateCapabilities} from "@psp-cdl/cdl";
import {identifier,type Principal} from "@psp-cdl/api-server";
import {WorkflowStore,StoreError,bounded,integer,validScope,validScopedCompletion,validThreatPolicy,SCOPED_PROFILE} from "@psp-cdl/api-server/persistence";
import {McpDispatchGate,bindingDigest} from "@psp-cdl/mcpproxy";
import {DurableLlmLoop,type DurableHost,type DurableOptions} from "./durable.js";
import {LoopError,promptContext,type ProviderRegistration} from "./loop.js";

export {SCOPED_PROFILE};
export interface ScopeConfiguration {id:string;version:string;system:string;threatPolicy:{id:string;version:string}|null}
export interface ScopedHost extends DurableHost {
  applicationThreat(principal:Principal,binding:Record<string,unknown>,session:Record<string,unknown>):
    {policy:{id:string;version:string};state:Record<string,unknown>}|Promise<{policy:{id:string;version:string};state:Record<string,unknown>}>;
  scopedPrompt(principal:Principal,binding:Record<string,unknown>):Envelope|Promise<Envelope>;
  scopeBoundary(principal:Principal,binding:Record<string,unknown>,data:Record<string,unknown>):
    {bindingDigest:string;decision:"allow"|"deny"|"unsupported";threatState:Record<string,unknown>}|Promise<{bindingDigest:string;decision:"allow"|"deny"|"unsupported";threatState:Record<string,unknown>}>;
  planScopedTurn(principal:Principal,binding:Record<string,unknown>,data:Record<string,unknown>):
    {retained:Record<string,unknown>}|Promise<{retained:Record<string,unknown>}>;
}
const fail=(code:string):never=>{throw new LoopError(code);};
function copy(v:unknown,code="INVALID_REQUEST"):any {try{return bounded(v);}catch{return fail(code);}}
const same=(a:unknown,b:unknown)=>bindingDigest(a)===bindingDigest(b);
const exact=(v:unknown,keys:string):v is Record<string,any>=>record(v)&&Object.keys(v).sort().join(",")===keys;
async function call<T>(fn:()=>T|Promise<T>):Promise<T>{try{return await fn();}catch{return fail("HOST_ERROR");}}
export function scopedPromptContext(binding:Record<string,unknown>):Record<string,string> {
  const scope=binding.scope;
  if(!validScope(scope))return fail("INVALID_SCOPED_STATE");
  return {...promptContext(binding),"post-completion":"scoped","scope-id":scope.id,"scope-version":scope.version,"scope-digest":bindingDigest(scope),"threat-policy-id":scope.threatPolicy.id,"threat-policy-version":scope.threatPolicy.version};
}

/** Completed workflow state is frozen; follow-ups use a separate durable scope. */
export class ScopedLlmLoop extends DurableLlmLoop {
  private readonly definition:ScopeConfiguration;
  protected override get completionPolicy():string{return "scoped";}
  constructor(store:WorkflowStore,gate:McpDispatchGate,private readonly scopedHost:ScopedHost,provider:ProviderRegistration,configuration:{postCompletion:"scoped";scope:ScopeConfiguration}) {
    super(store,gate,scopedHost,provider,{postCompletion:"lockdown"});
    if(!store.scopedTurns||[scopedHost.applicationThreat,scopedHost.scopedPrompt,scopedHost.scopeBoundary,scopedHost.planScopedTurn].some(f=>typeof f!=="function"))fail("INVALID_CONFIGURATION");
    const config=copy(configuration,"UNSUPPORTED_POST_COMPLETION");
    if(!exact(config,"postCompletion,scope")||config.postCompletion!=="scoped"||!exact(config.scope,"id,system,threatPolicy,version")||!identifier(config.scope.id)||!identifier(config.scope.version)||typeof config.scope.system!=="string"||!config.scope.system.length||config.scope.threatPolicy!==null&&!validThreatPolicy(config.scope.threatPolicy))fail("UNSUPPORTED_POST_COMPLETION");
    this.definition=config.scope;
  }
  protected override verificationContext(binding:Record<string,unknown>):Record<string,string>{return binding.postCompletion==="scoped"?scopedPromptContext(binding):super.verificationContext(binding);}
  protected override async verify(p:Principal,binding:Record<string,unknown>,prompt:Envelope):Promise<void>{
    await super.verify(p,binding,prompt);
    if(binding.postCompletion==="scoped"&&bindingDigest({system:prompt.data})!==(binding.scope as Record<string,unknown>).systemDigest)fail("PROMPT_REJECTED");
  }
  protected override async prepareCommit(p:Principal,binding:Record<string,unknown>,command:Record<string,unknown>,options:DurableOptions):Promise<Record<string,unknown>> {
    let scope:Record<string,unknown>|null=null,threatState:Record<string,unknown>|null=null;
    if(command.complete) {
      const session=await this.store.execute({tenantId:p.tenantId,subjectId:p.subjectId},{action:"getSession",sessionId:command.sessionId});
      const threat=copy(await call(()=>this.scopedHost.applicationThreat(copy(p),copy({...binding,requestId:command.requestId,postCompletion:"scoped"}),copy(session))),"INVALID_SCOPED_STATE");
      if(!exact(threat,"policy,state")||!validThreatPolicy(threat.policy)||!record(threat.state))fail("INVALID_SCOPED_STATE");
      scope={id:this.definition.id,version:this.definition.version,systemDigest:bindingDigest({system:this.definition.system}),threatPolicy:this.definition.threatPolicy??threat.policy};threatState=threat.state;
    }
    this.check(options);return {...command,action:"commitScopedWorkflowTurn",scope,threatState};
  }
  protected override present(receipt:Record<string,unknown>,recovered:boolean):Record<string,unknown> {
    if(record(receipt.scoped)&&receipt.scoped.outcome==="violation")return fail("PSP_POST_COMPLETION_VIOLATION");
    return {...super.present(receipt,recovered),...(receipt.scoped?{scoped:copy(receipt.scoped)}:{})};
  }
  override async run(token:unknown,sessionId:string,request:unknown,options:DurableOptions):Promise<Record<string,unknown>> {
    return this.boundary(async()=>{
      const input=copy(request),controls=this.controls(options);
      if(!exact(input,"message")||typeof input.message!=="string"||!identifier(sessionId)||!identifier(options.requestId)||!integer(options.expectedVersion)||options.expectedVersion<1||!integer(options.maxSteps)||options.maxSteps<1||options.maxSteps>32)fail("INVALID_REQUEST");
      options={...controls,requestId:options.requestId,expectedVersion:options.expectedVersion,maxSteps:options.maxSteps};
      const p=await this.identity(token,"sessions:write"),owner={tenantId:p.tenantId,subjectId:p.subjectId};this.check(controls);
      const session=await this.coordinator.run(owner,()=>this.store.execute(owner,{action:"getSession",sessionId}));
      if(session.status==="running")return super.run(token,sessionId,input,options);
      const state=session.llmCompletion;
      if(session.status!=="completed"||!validScopedCompletion(state))return fail("INACTIVE_SESSION");
      const expected={id:this.definition.id,version:this.definition.version,systemDigest:bindingDigest({system:this.definition.system}),threatPolicy:this.definition.threatPolicy??state.scope.threatPolicy};
      if(!same(state.scope,expected))fail("SCOPED_STATE_MISMATCH");
      const inputDigest=bindingDigest(input);
      let old:Record<string,unknown>|undefined;
      try{old=await this.store.execute(owner,{action:"getTurn",sessionId,requestId:options.requestId});}catch(e){if(!(e instanceof StoreError&&e.code==="NOT_FOUND"))throw e;}
      if(old)fail(old.inputDigest===inputDigest&&old.sessionVersion===options.expectedVersion+1?"TURN_ALREADY_COMMITTED":"IDEMPOTENCY_CONFLICT");
      if(session.version!==options.expectedVersion)fail("STALE_SESSION");
      const completed=await this.store.execute(owner,{action:"getTurn",sessionId,requestId:state.requestId});
      if(!record(completed.output)||typeof completed.output.text!=="string"||!record(completed.retained))fail("INVALID_SCOPED_STATE");
      const completedText=(completed.output as Record<string,string>).text!;
      const authority=await this.snapshot(p,session),expires=Math.min(authority.expires,session.expiresAt as number);
      const binding={...owner,sessionId,sessionVersion:session.version,nodeId:session.nodeId,nodeVersion:session.nodeVersion,epoch:this.store.epoch,policyVersion:authority.policyVersion,authorityRevision:authority.revision,providerId:this.provider.id,providerRevision:this.provider.revision,registryRevision:authority.registryRevision,deadline:options.deadline,requestId:options.requestId,inputDigest,postCompletion:"scoped",scope:state.scope,scopeDigest:bindingDigest(state.scope)};
      let prompt:Envelope|undefined,threatState=copy(state.threatState),retained=copy(state.retained),output:Record<string,unknown>|null=null,violationPhase:string|null=null,data:Record<string,unknown>|undefined;
      const fresh=async(version?:unknown)=>{
        this.check(controls,expires);const live=await this.identity(token,"sessions:write",p),current=await this.store.execute(owner,{action:"getSession",sessionId});
        if(version===undefined?!same(current,session):current.version!==version||current.status!=="completed")fail("STALE_SESSION");
        if(!same(await this.snapshot(live,current),authority))fail("STALE_AUTHORITY");
        if(prompt)await this.verify(live,binding,prompt);this.check(controls,expires);
      };
      const boundary=async(phase:"ingress"|"egress",candidate:unknown=null)=>{
        const value={request:input,completedOutput:completed.output,completedRetained:completed.retained,retained:state.retained,threatState,candidate};
        const bound={...binding,phase,threatDigest:bindingDigest(threatState),dataDigest:bindingDigest(value)};
        const decision=copy(await call(()=>this.scopedHost.scopeBoundary(copy(p),copy(bound),copy(value))),"INVALID_SCOPE_DECISION");
        if(!exact(decision,"bindingDigest,decision,threatState")||decision.bindingDigest!==bindingDigest(bound)||!["allow","deny","unsupported"].includes(decision.decision)||!record(decision.threatState))fail("INVALID_SCOPE_DECISION");
        if(decision.decision==="unsupported")fail("UNSUPPORTED_SCOPE");
        threatState=decision.threatState;await fresh();
        if(decision.decision==="deny"){violationPhase=phase;return false;}return true;
      };
      await this.coordinator.run(owner,async()=>{
        await fresh();if(!await boundary("ingress"))return;
        prompt=copy(await call(()=>this.scopedHost.scopedPrompt(copy(p),copy(binding))),"PROMPT_REJECTED");await fresh();
        const providerRequest={messages:[{role:"system",content:prompt!.data},{role:"assistant",content:completedText},{role:"user",content:input.message}],tools:[]};
        data=copy({request:providerRequest,retained,completedRetained:completed.retained});
        await this.decide(p,binding,data!,"inference",aggregateCapabilities(this.provider.sources,this.provider.complete));await fresh();
        let raw:unknown;try{raw=await this.provider.invoke(copy(providerRequest),{...controls});}catch{this.check(controls,expires);return fail("PROVIDER_FAILED");}
        await fresh();const candidate=copy(raw,"INVALID_RESPONSE");
        if(record(candidate)&&candidate.type==="tool")fail("TOOL_NOT_ALLOWED");
        if(!exact(candidate,"text,type")||candidate.type!=="final"||typeof candidate.text!=="string")fail("INVALID_RESPONSE");
        if(!await boundary("egress",candidate))return;
        data=copy({...data,candidate});
        const context=await this.decide(p,binding,data!,"release",aggregateCapabilities(authority.releaseSources,authority.releaseComplete));await fresh();
        if(await call(()=>this.host.authorizeFinal(copy(p),copy(context),copy(data)))!==true)fail("COMPLETION_DENIED");
        const plan=copy(await call(()=>this.scopedHost.planScopedTurn(copy(p),copy({...context,threatDigest:bindingDigest(threatState)}),copy(data))),"INVALID_PLAN");
        if(!exact(plan,"retained")||!record(plan.retained))fail("INVALID_PLAN");retained=plan.retained;
        output={text:candidate.text,provenance:{profile:"PSP-LLM-LOOP-0.1",providerId:this.provider.id,providerRevision:this.provider.revision,outputDigest:bindingDigest({text:candidate.text}),trustLevel:5,steps:1}};await fresh();
      });
      const command={action:"commitScopedTurn",requestId:options.requestId,sessionId,expectedVersion:options.expectedVersion,nodeId:session.nodeId,nodeVersion:session.nodeVersion,policyVersion:session.policyVersion,inputDigest,scopeDigest:bindingDigest(state.scope),threatState,retained,output,violationPhase};
      let guardError:unknown;
      const receipt=await this.store.execute(owner,command,async context=>{
        try{if(context.replay)fail("TURN_ALREADY_COMMITTED");await fresh();await this.authorizeCommit(p,binding,context,options);await fresh();return true;}catch(e){guardError=e;return false;}
      }).catch(e=>{throw guardError??e;});
      if(violationPhase!==null)return fail("PSP_POST_COMPLETION_VIOLATION");
      return this.coordinator.run(owner,async()=>{
        await fresh(receipt.sessionVersion);await this.decide(p,{...binding,committedVersion:receipt.sessionVersion},copy({...data,retained}),"release",aggregateCapabilities(authority.releaseSources,authority.releaseComplete));await fresh(receipt.sessionVersion);return this.present(receipt,false);
      });
    });
  }
}
