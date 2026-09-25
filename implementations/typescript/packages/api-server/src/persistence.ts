// SPDX-License-Identifier: Apache-2.0
import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { byteLength, canonicalJson, record, validateJson } from "@psp-cdl/core";
import { identifier } from "./service.js";
import {PROMPT_REFRESH_PROFILE,validPromptState,comparePromptVersions} from "./prompt-state.js";
import {REDIRECT_PROFILE,validRedirect} from "./redirect-state.js";
export {REDIRECT_PROFILE,validRedirect,validRedirectTarget} from "./redirect-state.js";
export {PROMPT_REFRESH_PROFILE,validPromptState,comparePromptVersions} from "./prompt-state.js";
import {SCOPED_PROFILE,validScope,validScopedCompletion,validScopedOutput,validDigest,scopedDigest} from "./scoped-state.js";
export {SCOPED_PROFILE,validScope,validScopedCompletion,validThreatPolicy,scopedDigest} from "./scoped-state.js";
export type OwnerReservation=object;

export const PERSISTENCE_PROFILE = "PSP-PERSISTENCE-0.1";
export const MAX_STATE_BYTES = 1_048_576;
export class StoreError extends Error {
  constructor(public readonly code:string) { super(code); this.name="StoreError"; }
}
export type Kind = "node" | "session" | "checkpoint" | "receipt";
export interface Key { kind:Kind; id:string }
export interface StoredRecord extends Key { revision:number; body:Record<string,unknown> }
export interface Comparison extends Key { revision:number|null }
export interface AtomicBackend {
  readonly epoch:string;
  now():number;
  read(tenantId:string, key:Key):StoredRecord|null|Promise<StoredRecord|null>;
  commit(tenantId:string, checks:Comparison[], writes:StoredRecord[], expiresAt:number):boolean|Promise<boolean>;
}
export interface Actor { tenantId:string; subjectId:string }
export interface AccessContext {
  command:Record<string,unknown>; current:Record<string,unknown>|null;
  result:Record<string,unknown>; replay:boolean;
}
export type AccessGuard = (context:AccessContext)=>boolean|Promise<boolean>;
export interface PersistenceHost {
  resumeSecret:Uint8Array;
  authorizePersistence(actor:Actor, writes:StoredRecord[]):boolean|Promise<boolean>;
  coordinator?:OwnerCoordinator;
  durableTurns?:boolean;
  promptRefresh?:boolean;
  redirectTurns?:boolean;
  scopedTurns?:boolean;
}
/** Optional single-process, fail-fast exclusion. Share across every writer and gate. */
export class OwnerCoordinator {
  private readonly busy=new Map<string,OwnerReservation>();
  async run<T>(actor:Actor, work:()=>T|Promise<T>):Promise<T> {
    return this.runReserved(actor,()=>work());
  }
  owns(actor:Actor,reservation:OwnerReservation):boolean {return !!reservation&&this.busy.get(canonicalJson([actor.tenantId,actor.subjectId]))===reservation;}
  async runReserved<T>(actor:Actor,work:(reservation:OwnerReservation)=>T|Promise<T>):Promise<T> {
    if(!identifier(actor.tenantId)||!identifier(actor.subjectId)) throw new StoreError("INVALID_STATE");
    const key=canonicalJson([actor.tenantId,actor.subjectId]);
    if(this.busy.has(key)) throw new StoreError("STATE_BUSY");
    const reservation=Object.freeze({});this.busy.set(key,reservation);
    try { return await work(reservation); } finally { this.busy.delete(key); }
  }
}
export type WorkflowCommand =
  | {action:"commitScopedWorkflowTurn";requestId:string;sessionId:string;expectedVersion:number;nodeId:string;nodeVersion:string;policyVersion:string;state:Record<string,unknown>;inputDigest:string;output:Record<string,unknown>;retained:Record<string,unknown>;complete:boolean;postCompletion:"scoped";scope:Record<string,unknown>|null;threatState:Record<string,unknown>|null}
  | {action:"commitScopedTurn";requestId:string;sessionId:string;expectedVersion:number;nodeId:string;nodeVersion:string;policyVersion:string;inputDigest:string;scopeDigest:string;threatState:Record<string,unknown>;retained:Record<string,unknown>;output:Record<string,unknown>|null;violationPhase:"ingress"|"egress"|null}
  | {action:"commitRedirectTurn";requestId:string;sessionId:string;expectedVersion:number;nodeId:string;nodeVersion:string;policyVersion:string;state:Record<string,unknown>;inputDigest:string;output:Record<string,unknown>;retained:Record<string,unknown>;complete:boolean;postCompletion:"redirect";redirect:{target:string;nodeId:string;nodeVersion:string;policyVersion:string;expiresAt:number}|null}
  | {action:"putNode";nodeId:string;nodeVersion:string;definition:Record<string,unknown>}
  | {action:"getNode";nodeId:string;nodeVersion:string}
  | {action:"createSession";requestId:string;nodeId:string;nodeVersion:string;policyVersion:string;expiresAt:number;state:Record<string,unknown>}
  | {action:"getSession";sessionId:string}
  | {action:"getPromptState";sessionId:string}
  | {action:"putPromptState";sessionId:string;expectedVersion:number;refreshRevision:number;state:Record<string,unknown>}
  | {action:"commitRefreshedTurn";requestId:string;sessionId:string;expectedVersion:number;refreshRevision:number;nodeId:string;nodeVersion:string;policyVersion:string;state:Record<string,unknown>;inputDigest:string;output:Record<string,unknown>;retained:Record<string,unknown>;complete:boolean;postCompletion:"lockdown"}
  | {action:"getTurn";sessionId:string;requestId:string}
  | {action:"commitTurn";requestId:string;sessionId:string;expectedVersion:number;nodeId:string;nodeVersion:string;policyVersion:string;state:Record<string,unknown>;inputDigest:string;output:Record<string,unknown>;retained:Record<string,unknown>;complete:boolean;postCompletion:"lockdown"}
  | {action:"updateSession";requestId:string;sessionId:string;expectedVersion:number;nodeId:string;nodeVersion:string;policyVersion:string;status:"running"|"completed";state:Record<string,unknown>}
  | {action:"createCheckpoint";requestId:string;sessionId:string;expectedVersion:number;expiresAt:number}
  | {action:"resumeCheckpoint";requestId:string;checkpointId:string;resumeToken:string;state:Record<string,unknown>};
function fail(code:string):never { throw new StoreError(code); }
export const integer=(v:unknown):v is number=>typeof v==="number"&&Number.isSafeInteger(v)&&v>=0;
const positive=(v:unknown):v is number=>integer(v)&&v>0;
const uuid=(v:unknown):v is string=>typeof v==="string"&&/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(v)&&v.length===36;
const hash=(v:string)=>createHash("sha256").update(v,"utf8").digest("hex");
export function bounded(value:unknown):any {
  try { const copy=validateJson(value); if(byteLength(canonicalJson(copy))>MAX_STATE_BYTES) fail("INVALID_STATE"); return copy; }
  catch { return fail("INVALID_STATE"); }
}
const equal=(a:unknown,b:unknown)=>canonicalJson(a)===canonicalJson(b);
const key=(kind:Kind,id:string):Key=>({kind,id});
const nodeKey=(id:string,version:string)=>key("node",hash(canonicalJson([id,version])));
const check=(r:StoredRecord):Comparison=>({kind:r.kind,id:r.id,revision:r.revision});
const absent=(k:Key):Comparison=>({...k,revision:null});
const row=(k:Key,body:Record<string,unknown>,revision=1):StoredRecord=>({...k,revision,body});
export function validateBatch(tenantId:string, checks:Comparison[], writes:StoredRecord[], expiresAt:number):void {
  bounded([checks,writes]);
  if(!identifier(tenantId)||!integer(expiresAt)||!Array.isArray(checks)||!Array.isArray(writes)||!checks.length||!writes.length||checks.length>16||writes.length>16) fail("INVALID_STATE");
  const seen=new Map<string,number|null>();
  for(const c of checks) {
    if(!record(c)||Object.keys(c).length!==3||!Object.hasOwn(c,"revision")||!["node","session","checkpoint","receipt"].includes(c.kind)||!identifier(c.id)||(c.revision!==null&&!positive(c.revision))) fail("INVALID_STATE");
    const k=canonicalJson([c.kind,c.id]); if(seen.has(k)) fail("INVALID_STATE"); seen.set(k,c.revision);
  }
  const written=new Set<string>();
  for(const w of writes) {
    if(!record(w)||Object.keys(w).length!==4||!identifier(w.id)||typeof w.kind!=="string") fail("INVALID_STATE");
    const k=canonicalJson([w.kind,w.id]);
    if(written.has(k)||!seen.has(k)||!positive(w.revision)||w.revision!==(seen.get(k)??0)+1||!record(w.body)) fail("INVALID_STATE");
    written.add(k);
  }
}

/** Trusted-host API only: authenticate and authorize transitions before calling. */
export class WorkflowStore {
  get epoch():string { return this.backend.epoch; }
  readonly coordinator:OwnerCoordinator|undefined;
  readonly durableTurns:boolean;
  readonly promptRefresh:boolean;
  readonly redirectTurns:boolean;
  readonly scopedTurns:boolean;
  private readonly secret:Uint8Array;
  constructor(protected readonly backend:AtomicBackend, protected readonly host:PersistenceHost) {
    if(!identifier(backend.epoch)||!(host.resumeSecret instanceof Uint8Array)||host.resumeSecret.length<32||typeof host.authorizePersistence!=="function") fail("INVALID_CONFIGURATION");
    this.secret=new Uint8Array(host.resumeSecret);
    if(host.coordinator!==undefined&&!(host.coordinator instanceof OwnerCoordinator)) fail("INVALID_CONFIGURATION");
    this.coordinator=host.coordinator;
    if(host.durableTurns!==undefined&&typeof host.durableTurns!=="boolean") fail("INVALID_CONFIGURATION");
    this.durableTurns=host.durableTurns===true;
    if(host.promptRefresh!==undefined&&typeof host.promptRefresh!=="boolean"||host.promptRefresh&&!this.durableTurns)fail("INVALID_CONFIGURATION");
    this.promptRefresh=host.promptRefresh===true;
    if(host.redirectTurns!==undefined&&typeof host.redirectTurns!=="boolean"||host.redirectTurns&&(!this.durableTurns||this.promptRefresh))fail("INVALID_CONFIGURATION");
    this.redirectTurns=host.redirectTurns===true;
    if(host.scopedTurns!==undefined&&typeof host.scopedTurns!=="boolean"||host.scopedTurns&&(!this.durableTurns||this.promptRefresh||this.redirectTurns))fail("INVALID_CONFIGURATION");
    this.scopedTurns=host.scopedTurns===true;
  }
  private token(actor:Actor,id:string):string {
    const mac=createHmac("sha256",this.secret).update(canonicalJson([PERSISTENCE_PROFILE,this.backend.epoch,actor.tenantId,actor.subjectId,id])).digest("base64url");
    return id+"."+mac;
  }
  private now():number { const n=this.backend.now(); if(!integer(n)) fail("INVALID_CLOCK"); return n; }
  private async owned(actor:Actor, kind:"session"|"checkpoint",id:string):Promise<StoredRecord> {
    const r=await this.backend.read(actor.tenantId,key(kind,id));
    if(!r||r.body.subjectId!==actor.subjectId||r.body.tenantId!==actor.tenantId||r.body.status==="purged"||r.body.tombstone===true) fail("NOT_FOUND");
    return r;
  }
  private live(r:StoredRecord,now:number):void { if(!integer(r.body.expiresAt)) fail("STORE_CORRUPT"); if(now>=r.body.expiresAt) fail("EXPIRED"); }
  private async node(actor:Actor,id:string,version:string):Promise<StoredRecord> {
    const r=await this.backend.read(actor.tenantId,nodeKey(id,version)); if(!r) fail("NOT_FOUND"); return r;
  }
  private async result(actor:Actor,result:Record<string,unknown>):Promise<Record<string,unknown>> {
    const out=bounded(result);
    if(out.sessionId) {
      const session=await this.owned(actor,"session",out.sessionId);
      if(session.body.status==="cancelled")fail("INVALID_TRANSITION");
    }
    if(out.checkpointId) {
      const cp=await this.owned(actor,"checkpoint",out.checkpointId);
      const token=this.token(actor,out.checkpointId);
      if(hash(token)!==cp.body.tokenHash) fail("CHECKPOINT_KEY_CHANGED");
      out.resumeToken=token;
    }
    return out;
  }
  async execute(actorValue:Actor, commandValue:unknown, guard?:AccessGuard,reservation?:OwnerReservation):Promise<Record<string,unknown>> {
    // A winner may commit between our first receipt lookup and a state read.
    // One fresh attempt observes its receipt; unchanged expected versions still fail.
    const actor=bounded(actorValue) as Actor, command=bounded(commandValue);
    if(reservation!==undefined) {
      if(!record(actor)||!record(command)||command.action!=="putPromptState"||!this.coordinator?.owns(actor,reservation))fail("INVALID_RESERVATION");
      const original=guard;
      guard=async c=>{if(!this.coordinator?.owns(actor,reservation))fail("INVALID_RESERVATION");const ok=original?await original(c):true;return ok===true&&this.coordinator!.owns(actor,reservation);};
    }
    const execute=()=>this.executeRetry(actor,command,guard);
    if(this.coordinator&&reservation===undefined&&record(command)&&!["getSession","getNode","getTurn","getPromptState"].includes(command.action as string)) return this.coordinator.run(actor,execute);
    return execute();
  }
  private async executeRetry(actor:Actor,command:unknown,guard?:AccessGuard):Promise<Record<string,unknown>> {
    try { return await this.executeOnce(actor,command,guard); }
    catch(e) {
      if(e instanceof StoreError&&["STATE_CONFLICT","CHECKPOINT_CONSUMED","INVALID_TRANSITION"].includes(e.code)) return this.executeOnce(actor,command,guard);
      throw e;
    }
  }
  private async executeOnce(actorValue:Actor, commandValue:unknown, guard?:AccessGuard):Promise<Record<string,unknown>> {
    const actor=bounded(actorValue) as Actor, c=bounded(commandValue);
    const access=async(result:Record<string,unknown>,current:Record<string,unknown>|null=null,replay=false)=>{
      if(guard) {
        let allowed:unknown;
        try { allowed=await guard({command:bounded(c),current:current===null?null:bounded(current),result:bounded(result),replay}); } catch { fail("AUTHORIZATION_DENIED"); }
        if(allowed!==true) fail("AUTHORIZATION_DENIED");
      }
      return bounded(result);
    };
    if(!record(actor)||Object.keys(actor).length!==2||!identifier(actor.tenantId)||!identifier(actor.subjectId)||!record(c)) fail("INVALID_STATE");
    const fields:Record<string,string[]>={
      putNode:["nodeId","nodeVersion","definition"], getNode:["nodeId","nodeVersion"],
      createSession:["requestId","nodeId","nodeVersion","policyVersion","expiresAt","state"],
      getSession:["sessionId"],
      updateSession:["requestId","sessionId","expectedVersion","nodeId","nodeVersion","policyVersion","status","state"],
      createCheckpoint:["requestId","sessionId","expectedVersion","expiresAt"],
      resumeCheckpoint:["requestId","checkpointId","resumeToken","state"]
    };
    if(this.durableTurns) Object.assign(fields,{
      getTurn:["sessionId","requestId"],
      commitTurn:["requestId","sessionId","expectedVersion","nodeId","nodeVersion","policyVersion","state","inputDigest","output","retained","complete","postCompletion"]
    });
    if(this.promptRefresh)Object.assign(fields,{getPromptState:["sessionId"],putPromptState:["sessionId","expectedVersion","refreshRevision","state"],commitRefreshedTurn:[...fields.commitTurn!,"refreshRevision"]});
    if(this.redirectTurns)fields.commitRedirectTurn=[...fields.commitTurn!,"redirect"];
    if(this.scopedTurns)Object.assign(fields,{commitScopedWorkflowTurn:[...fields.commitTurn!,"scope","threatState"],commitScopedTurn:["requestId","sessionId","expectedVersion","nodeId","nodeVersion","policyVersion","inputDigest","scopeDigest","threatState","retained","output","violationPhase"]});
    const names=typeof c.action==="string"&&Object.hasOwn(fields,c.action)?fields[c.action]:undefined;
    if(!names||Object.keys(c).length!==names.length+1||names.some(n=>!Object.hasOwn(c,n))) fail("INVALID_COMMAND");
    for(const n of ["requestId","nodeId","nodeVersion","policyVersion"]) if(Object.hasOwn(c,n)&&!identifier(c[n])) fail("INVALID_COMMAND");
    for(const n of ["sessionId","checkpointId"]) if(Object.hasOwn(c,n)&&!uuid(c[n])) fail("INVALID_COMMAND");
    if(("state" in c&&!record(c.state))||("definition" in c&&!record(c.definition))||("expectedVersion" in c&&!positive(c.expectedVersion))||("expiresAt" in c&&!positive(c.expiresAt))||("status" in c&&!["running","completed"].includes(c.status as string))) fail("INVALID_COMMAND");
    if(c.action==="resumeCheckpoint"&&(typeof c.resumeToken!=="string"||c.resumeToken.length!==80)) fail("INVALID_TOKEN");
    if("refreshRevision" in c&&!integer(c.refreshRevision))fail("INVALID_COMMAND");
    if(c.action==="putPromptState"&&!validPromptState(c.state))fail("INVALID_COMMAND");
    if(["commitTurn","commitRefreshedTurn","commitRedirectTurn","commitScopedWorkflowTurn"].includes(c.action as string)) {
      const o=c.output,p=record(o)?o.provenance:null;
      if(typeof c.complete!=="boolean"||c.postCompletion!==(c.action==="commitRedirectTurn"?"redirect":c.action==="commitScopedWorkflowTurn"?"scoped":"lockdown")||!record(c.retained)||typeof c.inputDigest!=="string"||c.inputDigest.length!==64||!/^[0-9a-f]{64}$/.test(c.inputDigest)||
        !record(o)||Object.keys(o).sort().join(",")!=="provenance,text"||typeof o.text!=="string"||!record(p)||
        Object.keys(p).sort().join(",")!=="outputDigest,profile,providerId,providerRevision,steps,trustLevel"||p.profile!=="PSP-LLM-LOOP-0.1"||p.trustLevel!==5||
        !identifier(p.providerId)||!identifier(p.providerRevision)||!positive(p.steps)||(p.steps as number)>32||p.outputDigest!==hash(canonicalJson({text:o.text}))) fail("INVALID_COMMAND");
      if(c.action==="commitRedirectTurn"&&(c.complete?!validRedirect(c.redirect)||c.redirect.nodeId===c.nodeId:c.redirect!==null))fail("INVALID_COMMAND");
    }
    if(c.action==="commitScopedWorkflowTurn"&&(c.complete?!validScope(c.scope)||!record(c.threatState):c.scope!==null||c.threatState!==null))fail("INVALID_COMMAND");
    if(c.action==="commitScopedTurn"&&(!validDigest(c.inputDigest)||!validDigest(c.scopeDigest)||!record(c.threatState)||!record(c.retained)||
      (c.violationPhase===null?!validScopedOutput(c.output):!["ingress","egress"].includes(c.violationPhase as string)||c.output!==null)))fail("INVALID_COMMAND");
    const now=this.now();
    const promptKey=key("receipt",hash(canonicalJson(["prompt-refresh",actor.subjectId,c.sessionId??null])));
    if(c.action==="getPromptState") {
      const s=await this.owned(actor,"session",c.sessionId as string);this.live(s,now);
      if(s.body.status==="cancelled")fail("INVALID_TRANSITION");
      const r=await this.backend.read(actor.tenantId,promptKey);if(!r||r.body.profile!==PROMPT_REFRESH_PROFILE)fail("NOT_FOUND");
      this.live(r,now);const out=await access({...r.body,revision:r.revision},s.body);
      const latest=await this.owned(actor,"session",s.id);if(latest.body.status==="cancelled")fail("INVALID_TRANSITION");return out;
    }
    if(c.action==="putPromptState") {
      const s=await this.owned(actor,"session",c.sessionId as string);this.live(s,now);
      if(s.revision!==c.expectedVersion)fail("STATE_CONFLICT");if(s.body.status!=="running")fail("INVALID_TRANSITION");
      const r=await this.backend.read(actor.tenantId,promptKey),old=r?.body.state as Record<string,any>|undefined,state=c.state as Record<string,any>;
      if((r?.revision??0)!==c.refreshRevision||r&&r.body.sessionVersion!==s.revision)fail("STATE_CONFLICT");
      if(r&&r.revision===Number.MAX_SAFE_INTEGER)fail("VERSION_EXHAUSTED");
      if(old&&(comparePromptVersions(state.version,old.version)<0||comparePromptVersions(state.version,old.version)===0&&state.digest!==old.digest))fail("PROMPT_ROLLBACK");
      if(state.turnCount!==0||state.refreshCount!==(old?old.refreshCount+1:0)||old&&state.timestamp<=old.timestamp)fail("INVALID_TRANSITION");
      const body={...actor,profile:PROMPT_REFRESH_PROFILE,sessionId:c.sessionId,sessionVersion:s.revision,expiresAt:s.body.expiresAt,state},revision=(r?.revision??0)+1;
      const checks=[check(s),r?check(r):absent(promptKey)],writes=[row(promptKey,body,revision)];validateBatch(actor.tenantId,checks,writes,s.body.expiresAt as number);
      let allowed;try{allowed=await this.host.authorizePersistence(bounded(actor),bounded(writes));}catch{fail("PERSISTENCE_DENIED");}if(allowed!==true)fail("PERSISTENCE_DENIED");
      const result={...body,revision};await access(result,r?.body??null);
      if(!await this.backend.commit(actor.tenantId,checks,writes,s.body.expiresAt as number))fail("STATE_CONFLICT");return bounded(result);
    }
    if(c.action==="getSession") {
      const s=await this.owned(actor,"session",c.sessionId as string);this.live(s,this.now());
      if(s.body.status==="cancelled")fail("INVALID_TRANSITION");
      const out=await access(s.body,s.body);return this.result(actor,out);
    }
    if(c.action==="getNode") { const n=await this.node(actor,c.nodeId as string,c.nodeVersion as string); return access(n.body,n.body); }
    if(c.action==="getTurn") {
      const session=await this.owned(actor,"session",c.sessionId as string);
      if(session.body.status==="cancelled") fail("INVALID_TRANSITION");
      const r=await this.backend.read(actor.tenantId,key("receipt",hash(canonicalJson([actor.subjectId,c.requestId]))));
      if(!r||r.body.subjectId!==actor.subjectId||r.body.tenantId!==actor.tenantId||r.body.profile!=="PSP-LLM-DURABLE-0.1"||!record(r.body.result)||r.body.result.sessionId!==c.sessionId) fail("NOT_FOUND");
      this.live(r,this.now());const out=await access(r.body.result as Record<string,unknown>,null,true);return this.result(actor,out);
    }
    let current:Record<string,unknown>|null=null;
    let checks:Comparison[]=[], writes:StoredRecord[]=[], result:Record<string,unknown>, expiresAt=Number.MAX_SAFE_INTEGER;
    const receiptKey=c.requestId?key("receipt",hash(canonicalJson([actor.subjectId,c.requestId]))):null;
    // A token is never included in a stored receipt, only in its command digest.
    const digest=hash(canonicalJson(c));
    const receiptResult=async():Promise<Record<string,unknown>|null>=>{
      if(!receiptKey) return null;
      const r=await this.backend.read(actor.tenantId,receiptKey);
      if(!r) return null;
      if(r.body.subjectId!==actor.subjectId||r.body.tenantId!==actor.tenantId) fail("NOT_FOUND");
      if(r.body.digest!==digest) fail("IDEMPOTENCY_CONFLICT");
      if(r.body.tombstone===true) fail("RECEIPT_RETIRED");
      const result=r.body.result as Record<string,unknown>;
      if(result.sessionId) {
        const session=await this.owned(actor,"session",result.sessionId as string);
        if(session.body.status==="cancelled") fail("INVALID_TRANSITION");
      }
      this.live(r,this.now()); await access(r.body.result as Record<string,unknown>,null,true);
      return this.result(actor,r.body.result as Record<string,unknown>);
    };
    const cached=await receiptResult(); if(cached) return cached;
    if(c.action==="putNode") {
      const k=nodeKey(c.nodeId as string,c.nodeVersion as string), old=await this.backend.read(actor.tenantId,k);
      if(old) { if(!equal(old.body.definition,c.definition)) fail("NODE_CONFLICT"); return access(old.body,old.body,true); }
      result={tenantId:actor.tenantId,nodeId:c.nodeId,nodeVersion:c.nodeVersion,definition:c.definition,createdAt:now};
      checks=[absent(k)]; writes=[row(k,result)];
    } else if(c.action==="createSession") {
      const n=await this.node(actor,c.nodeId as string,c.nodeVersion as string);
      expiresAt=c.expiresAt as number; if(now>=expiresAt) fail("EXPIRED");
      const id=randomUUID(), k=key("session",id);
      result={...actor,sessionId:id,version:1,nodeId:c.nodeId,nodeVersion:c.nodeVersion,policyVersion:c.policyVersion,status:"running",state:c.state,createdAt:now,updatedAt:now,expiresAt};
      checks=[check(n),absent(k)]; writes=[row(k,result)];
    } else {
      let cp:StoredRecord|null=null;
      if(c.action==="resumeCheckpoint") {
        cp=await this.owned(actor,"checkpoint",c.checkpointId as string);
        const token=this.token(actor,cp.id), supplied=c.resumeToken as string;
        if(!timingSafeEqual(Buffer.from(hash(token)),Buffer.from(hash(supplied)))||hash(supplied)!==cp.body.tokenHash) fail("INVALID_TOKEN");
        this.live(cp,now); if(cp.body.consumed) fail("CHECKPOINT_CONSUMED");
      }
      const s=await this.owned(actor,"session",(cp?.body.sessionId??c.sessionId) as string); this.live(s,now);
      current=s.body;
      if(s.revision==Number.MAX_SAFE_INTEGER) fail("VERSION_EXHAUSTED");
      if(s.revision!==(cp?.body.sessionVersion??c.expectedVersion)) fail("STATE_CONFLICT");
      if(s.body.status!==(cp?"waiting":c.action==="commitScopedTurn"?"completed":"running")) fail("INVALID_TRANSITION");
      expiresAt=s.body.expiresAt as number;
      const next:Record<string,unknown>={...s.body,version:s.revision+1,updatedAt:now};
      checks=[check(s)];
      if(c.action==="commitScopedTurn") {
        const previous=s.body.llmCompletion;
        if(!validScopedCompletion(previous))fail("INVALID_TRANSITION");
        if(c.nodeId!==s.body.nodeId||c.nodeVersion!==s.body.nodeVersion||c.policyVersion!==s.body.policyVersion||c.scopeDigest!==scopedDigest(previous.scope))fail("STATE_CONFLICT");
        if(previous.turnCount===Number.MAX_SAFE_INTEGER||previous.violationCount===Number.MAX_SAFE_INTEGER)fail("VERSION_EXHAUSTED");
        const denied=c.violationPhase!==null,turnCount=previous.turnCount+1,violationCount=previous.violationCount+(denied?1:0);
        if(denied&&!equal(c.retained,previous.retained))fail("INVALID_COMMAND");
        next.llmCompletion={...previous,threatState:c.threatState,retained:c.retained,turnCount,violationCount};
        const signal=denied?{signal:"post_completion_violation",kind:"hard",phase:c.violationPhase,inputDigest:c.inputDigest,at:now}:null;
        result={profile:"PSP-LLM-DURABLE-0.1",requestId:c.requestId,sessionId:s.id,sessionVersion:next.version,status:"completed",inputDigest:c.inputDigest,output:c.output,retained:c.retained,
          scoped:{profile:SCOPED_PROFILE,scopeDigest:c.scopeDigest,turnCount,violationCount,outcome:denied?"violation":"answer",signal}};
      } else if(["commitTurn","commitRefreshedTurn","commitRedirectTurn","commitScopedWorkflowTurn"].includes(c.action as string)) {
        if(c.action==="commitRefreshedTurn") {
          const r=await this.backend.read(actor.tenantId,promptKey);
          if(!r||r.revision!==c.refreshRevision||r.body.sessionVersion!==s.revision)fail("STATE_CONFLICT");
          const state=r.body.state as Record<string,any>;if(!validPromptState(state)||state.turnCount===Number.MAX_SAFE_INTEGER||r.revision===Number.MAX_SAFE_INTEGER)fail("INVALID_STATE");
          checks.push(check(r));writes.push(row(promptKey,{...r.body,sessionVersion:next.version,state:{...state,turnCount:state.turnCount+1}},r.revision+1));
        }
        if(c.nodeId!==s.body.nodeId||c.nodeVersion!==s.body.nodeVersion||c.policyVersion!==s.body.policyVersion) fail("STATE_CONFLICT");
        if(c.complete&&now>253402300799) fail("INVALID_CLOCK");
        Object.assign(next,{state:c.state,status:c.complete?"completed":"running"});
        if(c.complete) Object.assign(next,{llmCompletion:{profile:"PSP-LLM-DURABLE-0.1",policy:"lockdown",requestId:c.requestId,lockedAt:now}});
        result={profile:"PSP-LLM-DURABLE-0.1",requestId:c.requestId,sessionId:s.id,sessionVersion:next.version,status:c.complete?"completed":"running",inputDigest:c.inputDigest,output:c.output,retained:c.retained};
        if(c.action==="commitScopedWorkflowTurn"&&c.complete) {
          next.llmCompletion={profile:SCOPED_PROFILE,policy:"scoped",requestId:c.requestId,completedAt:now,scope:c.scope,threatState:c.threatState,retained:c.retained,turnCount:0,violationCount:0};
          result.scoped={profile:SCOPED_PROFILE,scopeDigest:scopedDigest(c.scope),turnCount:0,violationCount:0,outcome:"completion",signal:null};
        }
        if(c.action==="commitRedirectTurn"&&c.complete) {
          const target=c.redirect as Record<string,unknown>;
          if((target.expiresAt as number)<=this.now()||(target.expiresAt as number)>expiresAt)fail("INVALID_EXPIRY");
          const node=await this.node(actor,target.nodeId as string,target.nodeVersion as string),id=randomUUID(),k=key("session",id);
          const redirect={profile:REDIRECT_PROFILE,...target,sessionId:id};
          const body={...actor,sessionId:id,version:1,nodeId:target.nodeId,nodeVersion:target.nodeVersion,policyVersion:target.policyVersion,status:"running",
            state:{input:c.output,retained:c.retained},createdAt:now,updatedAt:now,expiresAt:target.expiresAt};
          checks.push(check(node),absent(k));writes.push(row(k,body));
          Object.assign(next,{llmCompletion:{profile:REDIRECT_PROFILE,policy:"redirect",requestId:c.requestId,completedAt:now,redirect}});
          result.redirect=redirect;
        }
      } else if(c.action==="updateSession") {
        const n=await this.node(actor,c.nodeId as string,c.nodeVersion as string); checks.push(check(n));
        Object.assign(next,{nodeId:c.nodeId,nodeVersion:c.nodeVersion,policyVersion:c.policyVersion,status:c.status,state:c.state});
        result=next;
      } else if(c.action==="createCheckpoint") {
        if((c.expiresAt as number)>expiresAt) fail("INVALID_EXPIRY"); expiresAt=c.expiresAt as number; if(now>=expiresAt) fail("EXPIRED");
        const id=randomUUID(), k=key("checkpoint",id);
        Object.assign(next,{status:"waiting"});
        const body={...actor,checkpointId:id,sessionId:s.id,sessionVersion:s.revision+1,expiresAt,consumed:false,tokenHash:hash(this.token(actor,id))};
        checks.push(absent(k)); writes.push(row(k,body));
        result={checkpointId:id,sessionId:s.id,sessionVersion:s.revision+1,expiresAt};
      } else {
        checks.push(check(cp!)); expiresAt=cp!.body.expiresAt as number;
        writes.push(row(key("checkpoint",cp!.id),{...cp!.body,consumed:true},cp!.revision+1));
        Object.assign(next,{status:"running",state:c.state}); result=next;
      }
      writes.push(row(key("session",s.id),next,s.revision+1));
    }
    if(receiptKey) {
      checks.push(absent(receiptKey)); writes.push(row(receiptKey,{...actor,digest,expiresAt,result,...(["commitTurn","commitRefreshedTurn","commitRedirectTurn","commitScopedWorkflowTurn","commitScopedTurn"].includes(c.action as string)?{profile:"PSP-LLM-DURABLE-0.1"}:{})}));
    }
    validateBatch(actor.tenantId,checks,writes,expiresAt);
    let allowed:unknown;
    try { allowed=await this.host.authorizePersistence(bounded(actor),bounded(writes)); } catch { fail("PERSISTENCE_DENIED"); }
    if(allowed!==true) fail("PERSISTENCE_DENIED");
    await access(result,current);
    if(c.action==="commitRedirectTurn"&&c.complete&&this.now()>=(c.redirect as Record<string,number>).expiresAt!)fail("EXPIRED");
    if(!await this.backend.commit(actor.tenantId,checks,writes,c.action==="commitRedirectTurn"&&c.complete?Math.min(expiresAt,(c.redirect as Record<string,number>).expiresAt!):expiresAt)) {
      if(c.action==="putNode") {
        const winner=await this.node(actor,c.nodeId as string,c.nodeVersion as string);
        if(!equal(winner.body.definition,c.definition)) fail("NODE_CONFLICT"); return access(winner.body,winner.body,true);
      }
      const retry=await receiptResult(); if(retry) return retry; fail("STATE_CONFLICT");
    }
    return this.result(actor,result);
  }
}
