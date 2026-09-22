// SPDX-License-Identifier: Apache-2.0
import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { byteLength, canonicalJson, record, validateJson } from "@psp-cdl/core";
import { identifier } from "./service.js";

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
export interface PersistenceHost {
  resumeSecret:Uint8Array;
  authorizePersistence(actor:Actor, writes:StoredRecord[]):boolean|Promise<boolean>;
}
export type WorkflowCommand =
  | {action:"putNode";nodeId:string;nodeVersion:string;definition:Record<string,unknown>}
  | {action:"getNode";nodeId:string;nodeVersion:string}
  | {action:"createSession";requestId:string;nodeId:string;nodeVersion:string;policyVersion:string;expiresAt:number;state:Record<string,unknown>}
  | {action:"getSession";sessionId:string}
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
  private readonly secret:Uint8Array;
  constructor(private readonly backend:AtomicBackend, private readonly host:PersistenceHost) {
    if(!identifier(backend.epoch)||!(host.resumeSecret instanceof Uint8Array)||host.resumeSecret.length<32||typeof host.authorizePersistence!=="function") fail("INVALID_CONFIGURATION");
    this.secret=new Uint8Array(host.resumeSecret);
  }
  private token(actor:Actor,id:string):string {
    const mac=createHmac("sha256",this.secret).update(canonicalJson([PERSISTENCE_PROFILE,this.backend.epoch,actor.tenantId,actor.subjectId,id])).digest("base64url");
    return id+"."+mac;
  }
  private now():number { const n=this.backend.now(); if(!integer(n)) fail("INVALID_CLOCK"); return n; }
  private async owned(actor:Actor, kind:"session"|"checkpoint",id:string):Promise<StoredRecord> {
    const r=await this.backend.read(actor.tenantId,key(kind,id));
    if(!r||r.body.subjectId!==actor.subjectId||r.body.tenantId!==actor.tenantId) fail("NOT_FOUND");
    return r;
  }
  private live(r:StoredRecord,now:number):void { if(!integer(r.body.expiresAt)) fail("STORE_CORRUPT"); if(now>=r.body.expiresAt) fail("EXPIRED"); }
  private async node(actor:Actor,id:string,version:string):Promise<StoredRecord> {
    const r=await this.backend.read(actor.tenantId,nodeKey(id,version)); if(!r) fail("NOT_FOUND"); return r;
  }
  private async result(actor:Actor,result:Record<string,unknown>):Promise<Record<string,unknown>> {
    const out=bounded(result);
    if(out.checkpointId) {
      const cp=await this.owned(actor,"checkpoint",out.checkpointId);
      const token=this.token(actor,out.checkpointId);
      if(hash(token)!==cp.body.tokenHash) fail("CHECKPOINT_KEY_CHANGED");
      out.resumeToken=token;
    }
    return out;
  }
  async execute(actorValue:Actor, commandValue:unknown):Promise<Record<string,unknown>> {
    // A winner may commit between our first receipt lookup and a state read.
    // One fresh attempt observes its receipt; unchanged expected versions still fail.
    const actor=bounded(actorValue) as Actor, command=bounded(commandValue);
    try { return await this.executeOnce(actor,command); }
    catch(e) {
      if(e instanceof StoreError&&["STATE_CONFLICT","CHECKPOINT_CONSUMED","INVALID_TRANSITION"].includes(e.code)) return this.executeOnce(actor,command);
      throw e;
    }
  }
  private async executeOnce(actorValue:Actor, commandValue:unknown):Promise<Record<string,unknown>> {
    const actor=bounded(actorValue) as Actor, c=bounded(commandValue);
    if(!record(actor)||Object.keys(actor).length!==2||!identifier(actor.tenantId)||!identifier(actor.subjectId)||!record(c)) fail("INVALID_STATE");
    const fields:Record<string,string[]>={
      putNode:["nodeId","nodeVersion","definition"], getNode:["nodeId","nodeVersion"],
      createSession:["requestId","nodeId","nodeVersion","policyVersion","expiresAt","state"],
      getSession:["sessionId"],
      updateSession:["requestId","sessionId","expectedVersion","nodeId","nodeVersion","policyVersion","status","state"],
      createCheckpoint:["requestId","sessionId","expectedVersion","expiresAt"],
      resumeCheckpoint:["requestId","checkpointId","resumeToken","state"]
    };
    const names=typeof c.action==="string"&&Object.hasOwn(fields,c.action)?fields[c.action]:undefined;
    if(!names||Object.keys(c).length!==names.length+1||names.some(n=>!Object.hasOwn(c,n))) fail("INVALID_COMMAND");
    for(const n of ["requestId","nodeId","nodeVersion","policyVersion"]) if(Object.hasOwn(c,n)&&!identifier(c[n])) fail("INVALID_COMMAND");
    for(const n of ["sessionId","checkpointId"]) if(Object.hasOwn(c,n)&&!uuid(c[n])) fail("INVALID_COMMAND");
    if(("state" in c&&!record(c.state))||("definition" in c&&!record(c.definition))||("expectedVersion" in c&&!positive(c.expectedVersion))||("expiresAt" in c&&!positive(c.expiresAt))||("status" in c&&!["running","completed"].includes(c.status as string))) fail("INVALID_COMMAND");
    if(c.action==="resumeCheckpoint"&&(typeof c.resumeToken!=="string"||c.resumeToken.length!==80)) fail("INVALID_TOKEN");
    const now=this.now();
    if(c.action==="getSession") { const s=await this.owned(actor,"session",c.sessionId as string); this.live(s,this.now()); return bounded(s.body); }
    if(c.action==="getNode") return bounded((await this.node(actor,c.nodeId as string,c.nodeVersion as string)).body);
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
      this.live(r,this.now()); return this.result(actor,r.body.result as Record<string,unknown>);
    };
    const cached=await receiptResult(); if(cached) return cached;
    if(c.action==="putNode") {
      const k=nodeKey(c.nodeId as string,c.nodeVersion as string), old=await this.backend.read(actor.tenantId,k);
      if(old) { if(!equal(old.body.definition,c.definition)) fail("NODE_CONFLICT"); return bounded(old.body); }
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
      if(s.revision==Number.MAX_SAFE_INTEGER) fail("VERSION_EXHAUSTED");
      if(s.revision!==(cp?.body.sessionVersion??c.expectedVersion)) fail("STATE_CONFLICT");
      if(s.body.status!==(cp?"waiting":"running")) fail("INVALID_TRANSITION");
      expiresAt=s.body.expiresAt as number;
      const next={...s.body,version:s.revision+1,updatedAt:now};
      checks=[check(s)];
      if(c.action==="updateSession") {
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
      checks.push(absent(receiptKey)); writes.push(row(receiptKey,{...actor,digest,expiresAt,result}));
    }
    validateBatch(actor.tenantId,checks,writes,expiresAt);
    let allowed:unknown;
    try { allowed=await this.host.authorizePersistence(bounded(actor),bounded(writes)); } catch { fail("PERSISTENCE_DENIED"); }
    if(allowed!==true) fail("PERSISTENCE_DENIED");
    if(!await this.backend.commit(actor.tenantId,checks,writes,expiresAt)) {
      if(c.action==="putNode") {
        const winner=await this.node(actor,c.nodeId as string,c.nodeVersion as string);
        if(!equal(winner.body.definition,c.definition)) fail("NODE_CONFLICT"); return bounded(winner.body);
      }
      const retry=await receiptResult(); if(retry) return retry; fail("STATE_CONFLICT");
    }
    return this.result(actor,result);
  }
}
