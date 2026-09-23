// SPDX-License-Identifier: Apache-2.0
import {canonicalVersion,type Envelope} from "@psp-cdl/core";
import {SecurityService,ServiceError,type Principal} from "@psp-cdl/api-server";
import {WorkflowStore,StoreError,bounded,integer,validPromptState,comparePromptVersions,PROMPT_REFRESH_PROFILE,type OwnerReservation} from "@psp-cdl/api-server/persistence";
import {McpDispatchGate,bindingDigest} from "@psp-cdl/mcpproxy";
import {BufferedLlmLoop,LoopError,type LoopHost,type LoopOptions,type ProviderRegistration} from "./loop.js";
import {DurableLlmLoop,type DurableHost,type DurableOptions} from "./durable.js";
export {PROMPT_REFRESH_PROFILE,comparePromptVersions};
const attributes=["refresh-policy","refresh-interval","refresh-grace"];
const fail=(code:string):never=>{throw new LoopError(code);};
const copy=(v:unknown):any=>{try{return bounded(v);}catch{return fail("INVALID_REFRESH");}};
const owner=(p:Principal)=>({tenantId:p.tenantId,subjectId:p.subjectId});
async function call<T>(f:()=>T|Promise<T>):Promise<T>{try{return await f();}catch{return fail("HOST_ERROR");}}
type State=Record<string,any>;
export interface RefreshHost extends DurableHost {
  refresh(principal:Principal,binding:Record<string,unknown>,request:Record<string,unknown>):Envelope|Promise<Envelope>;
  authorizeRefresh(principal:Principal,binding:Record<string,unknown>,previous:Record<string,unknown>|null,candidate:Envelope):boolean|Promise<boolean>;
  auditRefresh(principal:Principal,event:Record<string,unknown>):boolean|Promise<boolean>;
}
function describe(prompt:Envelope):State {
  const s=prompt.signature,a=s.attributes??{},policy=a["refresh-policy"]??"expiration",policies=policy.split('|').sort();
  if(!policies.length||policies.some((p,i)=>!["expiration","interval"].includes(p)||policies.indexOf(p)!==i))fail("UNSUPPORTED_REFRESH");
  const decimal=(v:string|undefined,defaultValue:number)=>{if(v===undefined)return defaultValue;if(!/^(0|[1-9][0-9]*)$/.test(v)||/[^0-9]/.test(v)||!integer(Number(v)))return fail("INVALID_REFRESH");return Number(v);};
  const interval=decimal(a["refresh-interval"],0),grace=decimal(a["refresh-grace"],300);
  if(policies.includes("interval")!==(interval>0)||!policies.includes("interval")&&a["refresh-interval"]!==undefined)fail("INVALID_REFRESH");
  const text=(prompt.data as string).replace(/\r\n?/g,'\n').replace(/^[\t\n ]+|[\t\n ]+$/g,'');
  return {version:canonicalVersion(s.version),digest:bindingDigest({text,trustLevel:s.trustLevel??2,priority:s.priority??50,policies,interval,grace}),policies,interval,grace,timestamp:s.timestamp,expires:s.expires,turnCount:0,refreshCount:0};
}
async function saved(store:WorkflowStore,p:Principal,b:Record<string,unknown>):Promise<State|null> {
  try {const r=await store.execute(owner(p),{action:"getPromptState",sessionId:b.sessionId});if(!validPromptState(r.state))fail("INVALID_REFRESH_STATE");return r;}
  catch(e){if(e instanceof StoreError&&e.code==="NOT_FOUND")return null;throw e;}
}
async function pinned(store:WorkflowStore,p:Principal,b:Record<string,unknown>,prompt:Envelope):Promise<void> {
  const r=await saved(store,p,b),d=describe(prompt);
  if(!r||r.state.version!==d.version||r.state.digest!==d.digest)fail("STALE_PROMPT");
}
class RefreshBuffer extends BufferedLlmLoop {
  revision=0;
  private current:State|null=null;
  constructor(store:WorkflowStore,gate:McpDispatchGate,host:LoopHost,provider:ProviderRegistration,
    private refreshHost:RefreshHost,private onPrompt:(p:Envelope)=>void,private token:unknown,private options:DurableOptions){super(store,gate,host,provider);}
  protected override promptAttributes():string[]{return attributes;}
  protected override async verify(p:Principal,b:Record<string,unknown>,prompt:Envelope):Promise<void>{await super.verify(p,b,prompt);await pinned(this.store,p,b,prompt);}
  private async ensure(p:Principal,b:Record<string,unknown>):Promise<void>{
    this.check(this.options);
    const live=await new SecurityService({authenticate:t=>this.host.authenticate(t),now:()=>this.host.now(),resolve:()=>null}).authenticate(this.token);
    if(live.tenantId!==p.tenantId||live.subjectId!==p.subjectId||!["models:invoke","sessions:write"].every(s=>live.scopes.includes(s)))fail("FORBIDDEN");
    const s=await this.store.execute(owner(p),{action:"getSession",sessionId:b.sessionId});
    if(s.version!==b.sessionVersion||s.status!=="running")fail("STALE_SESSION");
    const a=await this.snapshot(live,s);this.check(this.options,Math.min(a.expires,s.expiresAt as number));
    if(a.revision!==b.authorityRevision||a.policyVersion!==b.policyVersion)fail("STALE_AUTHORITY");
  }
  private due(state:State,now:number):string|null {
    if(now>=state.expires||state.policies.includes("expiration")&&state.expires-now<=state.grace)return "expiration";
    if(state.policies.includes("interval")&&state.turnCount>=state.interval)return "interval";
    return null;
  }
  private async audit(p:Principal,b:Record<string,unknown>,signal:string,details:State):Promise<void>{
    let ok;try{ok=await this.refreshHost.auditRefresh(copy(p),copy({profile:PROMPT_REFRESH_PROFILE,signal,binding:b,at:this.host.now(),...details}));}catch{fail("AUDIT_FAILED");}
    if(ok!==true)fail("AUDIT_FAILED");
  }
  private async install(p:Principal,b:Record<string,unknown>,reservation:OwnerReservation,trigger:string|null):Promise<Envelope>{
    const previous=this.current?.state??null,started=this.host.now();
    try {
      await this.ensure(p,b);
      const request={session_id:b.sessionId,current_version:previous?.version??null,trigger:trigger??"initial",turn_count:previous?.turnCount??0};
      const prompt=copy(await call(()=>trigger?this.refreshHost.refresh(copy(p),copy(b),copy(request)):this.host.prompt(copy(p),copy({...b,refresh:request})))) as Envelope;
      await super.verify(p,b,prompt);const next=describe(prompt);
      if(previous){
        const comparison=comparePromptVersions(next.version,previous.version);
        if(comparison<0)fail("PROMPT_ROLLBACK");
        if(comparison===0&&next.digest!==previous.digest)fail("PROMPT_VERSION_CONFLICT");
        if(next.timestamp<started||next.timestamp<=previous.timestamp||next.expires-this.host.now()<=next.grace)fail("REFRESH_NOT_FRESH");
        next.refreshCount=previous.refreshCount+1;
      }
      if(await call(()=>this.refreshHost.authorizeRefresh(copy(p),copy({...b,trigger:trigger??"initial"}),copy(previous),copy(prompt)))!==true)fail("REFRESH_DENIED");
      await this.ensure(p,b);await super.verify(p,b,prompt);
      let guardError:unknown;
      const result=await this.store.execute(owner(p),{action:"putPromptState",sessionId:b.sessionId,expectedVersion:b.sessionVersion,refreshRevision:this.revision,state:next},async()=>{
        try{await this.ensure(p,b);await super.verify(p,b,prompt);return true;}catch(e){guardError=e;return false;}
      },reservation).catch(e=>{throw guardError??e;});
      this.current=result;this.revision=result.revision as number;
      await this.audit(p,b,trigger?"prompt_refreshed":"prompt_initialized",{trigger:trigger??"initial",previousVersion:previous?.version??null,version:next.version,digest:next.digest});
      await this.ensure(p,b);await this.verify(p,b,prompt);this.onPrompt(prompt);return prompt;
    }catch(e){
      const code=e instanceof LoopError?e.code:e instanceof ServiceError&&["UNAUTHENTICATED","FORBIDDEN"].includes(e.code)?e.code:e instanceof StoreError?["STATE_CONFLICT","PERSISTENCE_DENIED"].includes(e.code)?e.code:"HOST_ERROR":"HOST_ERROR";
      if(code!=="AUDIT_FAILED")await this.audit(p,b,code==="PROMPT_ROLLBACK"?"prompt_refresh_rollback":"prompt_refresh_failed",{trigger:trigger??"initial",previousVersion:previous?.version??null,code});
      return fail(code);
    }
  }
  protected override async loadPrompt(p:Principal,b:Record<string,unknown>,_options:LoopOptions,reservation:OwnerReservation):Promise<Envelope>{
    this.current=await saved(this.store,p,b);this.revision=this.current?.revision??0;
    if(this.current&&this.current.sessionVersion!==b.sessionVersion)fail("STALE_PROMPT");
    const trigger=this.current?this.due(this.current.state,this.host.now()):null;
    if(!this.current||trigger)return this.install(p,b,reservation,trigger);
    const prompt=copy(await call(()=>this.host.prompt(copy(p),copy({...b,refresh:{current_version:this.current!.state.version,trigger:"binding",turn_count:this.current!.state.turnCount}})))) as Envelope;
    await this.verify(p,b,prompt);
    await this.audit(p,b,"prompt_bound",{trigger:"binding",previousVersion:this.current!.state.version,version:this.current!.state.version,digest:this.current!.state.digest});
    await this.ensure(p,b);await this.verify(p,b,prompt);this.onPrompt(prompt);return prompt;
  }
  protected override async inferencePrompt(p:Principal,b:Record<string,unknown>,prompt:Envelope,_options:LoopOptions,reservation:OwnerReservation):Promise<Envelope>{
    const current=await saved(this.store,p,b);
    if(!current||current.revision!==this.revision||current.sessionVersion!==b.sessionVersion)fail("STALE_PROMPT");
    const trigger=this.due({...current!.state,expires:Math.min(current!.state.expires,prompt.signature.expires)},this.host.now());
    return trigger?this.install(p,b,reservation,trigger):prompt;
  }
}
/** Boundary-triggered refresh; the signing/compatibility authority is exclusively host-owned. */
export class RefreshingLlmLoop extends DurableLlmLoop {
  constructor(store:WorkflowStore,gate:McpDispatchGate,private refreshHost:RefreshHost,provider:ProviderRegistration,configuration:{postCompletion:"lockdown"}){
    super(store,gate,refreshHost,provider,configuration);
    if(!store.promptRefresh||[refreshHost.refresh,refreshHost.authorizeRefresh,refreshHost.auditRefresh].some(f=>typeof f!=="function"))fail("INVALID_CONFIGURATION");
  }
  protected override promptAttributes():string[]{return attributes;}
  protected override async verify(p:Principal,b:Record<string,unknown>,prompt:Envelope):Promise<void>{await super.verify(p,b,prompt);await pinned(this.store,p,b,prompt);}
  protected override makeBuffered(host:LoopHost,onPrompt:(prompt:Envelope)=>void,token:unknown,_session:Record<string,unknown>,options:DurableOptions):BufferedLlmLoop {
    return new RefreshBuffer(this.store,this.gate,host,this.provider,this.refreshHost,onPrompt,token,options);
  }
  protected override turnCommand(command:Record<string,unknown>,buffered:BufferedLlmLoop):Record<string,unknown>{return {...command,action:"commitRefreshedTurn",refreshRevision:(buffered as RefreshBuffer).revision};}
}
