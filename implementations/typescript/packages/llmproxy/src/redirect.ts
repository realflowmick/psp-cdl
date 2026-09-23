// SPDX-License-Identifier: Apache-2.0
import {record} from "@psp-cdl/core";
import {evaluateBatch,type PolicyInput} from "@psp-cdl/cdl";
import {type Principal} from "@psp-cdl/api-server";
import {WorkflowStore,bounded,validRedirect,validRedirectTarget,REDIRECT_PROFILE,type AccessContext} from "@psp-cdl/api-server/persistence";
import {McpDispatchGate,bindingDigest} from "@psp-cdl/mcpproxy";
import {DurableLlmLoop,type DurableHost,type DurableOptions} from "./durable.js";
import {LoopError,type ProviderRegistration} from "./loop.js";

export {REDIRECT_PROFILE};
export interface RedirectHost extends DurableHost {
  resolveRedirect(principal:Principal,binding:Record<string,unknown>,target:string):
    {nodeId:string;nodeVersion:string;policyVersion:string;expiresAt:number}|Promise<{nodeId:string;nodeVersion:string;policyVersion:string;expiresAt:number}>;
  redirectPolicy(principal:Principal,binding:Record<string,unknown>,data:Record<string,unknown>):
    {bindingDigest:string;resources:PolicyInput[]}|Promise<{bindingDigest:string;resources:PolicyInput[]}>;
}
const fail=(code:string):never=>{throw new LoopError(code);};
function copy(value:unknown,code="INVALID_REDIRECT"):any {try{return bounded(value);}catch{return fail(code);}}
async function call<T>(fn:()=>T|Promise<T>):Promise<T> {try{return await fn();}catch{return fail("HOST_ERROR");}}

/** Host-selected, same-owner completion handoff. Never invokes the target provider. */
export class RedirectingLlmLoop extends DurableLlmLoop {
  private readonly target:string;
  protected override get completionPolicy():string {return "redirect";}
  constructor(store:WorkflowStore,gate:McpDispatchGate,private readonly redirectHost:RedirectHost,provider:ProviderRegistration,configuration:{postCompletion:"redirect";target:string}) {
    super(store,gate,redirectHost,provider,{postCompletion:"lockdown"});
    if(!store.redirectTurns||[redirectHost.resolveRedirect,redirectHost.redirectPolicy].some(f=>typeof f!=="function"))fail("INVALID_CONFIGURATION");
    if(!record(configuration)||Object.keys(configuration).sort().join(",")!=="postCompletion,target"||configuration.postCompletion!=="redirect"||!validRedirectTarget(configuration.target))fail("UNSUPPORTED_POST_COMPLETION");
    this.target=configuration.target;
  }
  protected override async prepareCommit(p:Principal,binding:Record<string,unknown>,command:Record<string,unknown>,options:DurableOptions):Promise<Record<string,unknown>> {
    this.check(options);
    let redirect:Record<string,unknown>|null=null;
    if(command.complete) {
      const resolved=copy(await call(()=>this.redirectHost.resolveRedirect(copy(p),copy({...binding,requestId:command.requestId,postCompletion:"redirect"}),this.target)));
      if(!record(resolved)||Object.keys(resolved).sort().join(",")!=="expiresAt,nodeId,nodeVersion,policyVersion")fail("INVALID_REDIRECT");
      redirect={...resolved,target:this.target};
      const source=await this.store.execute({tenantId:p.tenantId,subjectId:p.subjectId},{action:"getSession",sessionId:command.sessionId});
      if(!validRedirect(redirect)||redirect.nodeId===command.nodeId||(redirect.expiresAt as number)<=this.host.now()||(redirect.expiresAt as number)>(source.expiresAt as number))fail("INVALID_REDIRECT");
    }
    this.check(options);
    return {...command,action:"commitRedirectTurn",redirect};
  }
  protected override async authorizeCommit(p:Principal,binding:Record<string,unknown>,context:AccessContext,options:DurableOptions):Promise<void> {
    await super.authorizeCommit(p,binding,context,options);
    if(!context.command.complete)return;
    const bound={...binding,requestId:context.command.requestId,postCompletion:"redirect",redirect:context.result.redirect,commandDigest:bindingDigest(context.command)};
    const data={output:context.command.output,retained:context.command.retained};
    const policy=copy(await call(()=>this.redirectHost.redirectPolicy(copy(p),copy(bound),copy(data))),"INVALID_POLICY");
    if(!record(policy)||Object.keys(policy).sort().join(",")!=="bindingDigest,resources"||policy.bindingDigest!==bindingDigest(bound)||!Array.isArray(policy.resources)||!policy.resources.length)fail("INVALID_POLICY");
    const decision=evaluateBatch(policy.resources).decision;
    if(decision==="unsupported")fail("UNSUPPORTED_POLICY");
    if(decision!=="allow")fail("REDIRECT_DENIED");
    this.check(options,(context.result.redirect as Record<string,number>).expiresAt);
  }
  protected override present(receipt:Record<string,unknown>,recovered:boolean):Record<string,unknown> {
    return {...super.present(receipt,recovered),...(receipt.redirect?{redirect:copy(receipt.redirect)}:{})};
  }
}
