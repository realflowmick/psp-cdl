// SPDX-License-Identifier: Apache-2.0
import {createHash} from "node:crypto";
import {canonicalJson,record} from "@psp-cdl/core";
import {WorkflowStore,StoreError,bounded,integer,type Actor,type AtomicBackend,type StoredRecord,type AccessGuard,type PersistenceHost} from "./persistence.js";
import {WorkflowService,workflowError,type WorkflowHost} from "./workflow.js";
import {ServiceError,identifier,scopeFor,type Operation,type Principal} from "./service.js";

export const LIFECYCLE_PROFILE="PSP-LIFECYCLE-0.1";
export interface LifecycleBackend extends AtomicBackend {
  listSessions(actor:Actor,after:string,limit:number,status:string,now:number):StoredRecord[]|Promise<StoredRecord[]>;
  cleanupCandidate(actor:Actor,sessionId:string):{record:StoredRecord|null;more:boolean}|Promise<{record:StoredRecord|null;more:boolean}>;
}
export interface LifecycleHost extends PersistenceHost {
  /** Approve removal and retention of ALL proposed tombstones on every cleanup page. */
  authorizeRetention(actor:Actor,context:{session:Record<string,unknown>;removed:StoredRecord[];writes:StoredRecord[];now:number}):boolean|Promise<boolean>;
}
const uuid=(v:unknown):v is string=>typeof v==="string"&&v.length===36&&/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(v);
function fail(code:string):never {throw new StoreError(code);}
const hash=(v:unknown)=>createHash("sha256").update(canonicalJson(v)).digest("hex");
const compare=(r:StoredRecord)=>({kind:r.kind,id:r.id,revision:r.revision});
export function lifecycleRequest(operation:string,value:unknown):Record<string,any> {
  const c=bounded(value),fields=operation==="listSessions"?["after","limit","status"]:["requestId","sessionId","expectedVersion"];
  if(!record(c)||Object.keys(c).length!==fields.length||fields.some(k=>!Object.hasOwn(c,k)))fail("INVALID_COMMAND");
  if(operation==="listSessions") {
    if(c.after!==null&&!uuid(c.after)||!integer(c.limit)||c.limit<1||c.limit>50||!["all","running","waiting","completed","cancelled","expired"].includes(c.status as string))fail("INVALID_COMMAND");
  } else if(!identifier(c.requestId)||!uuid(c.sessionId)||!integer(c.expectedVersion)||c.expectedVersion<1)fail("INVALID_COMMAND");
  return c;
}
/** Opt-in lifecycle extension. The original AtomicBackend contract remains usable. */
export class LifecycleStore extends WorkflowStore {
  constructor(private readonly lifecycleBackend:LifecycleBackend,private readonly lifecycleHost:LifecycleHost) {
    super(lifecycleBackend,lifecycleHost);
    if(typeof lifecycleBackend.listSessions!=="function"||typeof lifecycleBackend.cleanupCandidate!=="function"||typeof lifecycleHost.authorizeRetention!=="function")fail("INVALID_CONFIGURATION");
  }
  async lifecycle(actorValue:Actor,operation:"listSessions"|"cancelSession"|"purgeSession",value:unknown,guard:AccessGuard):Promise<Record<string,unknown>> {
    const actor=bounded(actorValue) as Actor,c=lifecycleRequest(operation,value);
    if(!record(actor)||Object.keys(actor).length!==2||!identifier(actor.tenantId)||!identifier(actor.subjectId)||typeof guard!=="function"||!["listSessions","cancelSession","purgeSession"].includes(operation))fail("INVALID_STATE");
    const run=async()=>{
      const now=this.backend.now();if(!integer(now))fail("INVALID_CLOCK");
      const access=async(result:Record<string,unknown>,current:Record<string,unknown>|null,replay=false)=>{
        let ok;try{ok=await guard({command:{action:operation,...bounded(c)},current:bounded(current),result:bounded(result),replay});}catch{fail("AUTHORIZATION_DENIED");}
        if(ok!==true)fail("AUTHORIZATION_DENIED");
      };
      if(operation==="listSessions") {
        await access({sessions:[],after:null},null);
        const rows=await this.lifecycleBackend.listSessions(actor,c.after??"",c.limit+1,c.status,now),page=rows.slice(0,c.limit);
        const sessions=[];
        for(const r of page) {await access(r.body,r.body);sessions.push(bounded(r.body));}
        return {sessions,after:rows.length>c.limit?page.at(-1)!.id:null};
      }
      const digest=hash({action:operation,...c}),receiptKey={kind:"receipt" as const,id:hash([actor.subjectId,c.requestId])};
      const replay=async()=>{
        const r=await this.backend.read(actor.tenantId,receiptKey);if(!r)return null;
        if(r.body.subjectId!==actor.subjectId||r.body.tenantId!==actor.tenantId)fail("NOT_FOUND");
        if(r.body.digest!==digest)fail("IDEMPOTENCY_CONFLICT");
        if(r.body.profile!==LIFECYCLE_PROFILE||!record(r.body.result))fail("RECEIPT_RETIRED");
        await access(r.body.result,null,true);return bounded(r.body.result);
      };
      const cached=await replay();if(cached)return cached;
      const s=await this.backend.read(actor.tenantId,{kind:"session",id:c.sessionId});
      if(!s||s.body.tenantId!==actor.tenantId||s.body.subjectId!==actor.subjectId)fail("NOT_FOUND");
      if(s.revision!==c.expectedVersion) {const winner=await replay();if(winner)return winner;fail("STATE_CONFLICT");}
      if(s.revision>=Number.MAX_SAFE_INTEGER)fail("VERSION_EXHAUSTED");
      let body:Record<string,unknown>,result:Record<string,unknown>,removed:StoredRecord[]=[];
      const checks=[compare(s),{...receiptKey,revision:null as number|null}],writes:StoredRecord[]=[];
      if(operation==="cancelSession") {
        if(!["running","waiting"].includes(s.body.status as string))fail("INVALID_TRANSITION");
        body={...s.body,status:"cancelled",version:s.revision+1,updatedAt:now};
        result={sessionId:s.id,version:body.version,status:"cancelled"};
      } else {
        if(!["completed","cancelled","purged"].includes(s.body.status as string)&&!(integer(s.body.expiresAt)&&now>=s.body.expiresAt))fail("INVALID_TRANSITION");
        const candidate=await this.lifecycleBackend.cleanupCandidate(actor,s.id);
        if(candidate.record) {
          const r=candidate.record;if(r.revision>=Number.MAX_SAFE_INTEGER)fail("VERSION_EXHAUSTED");
          removed=[r];checks.push(compare(r));
          writes.push({...r,revision:r.revision+1,body:{...actor,sessionId:s.id,tombstone:true,...(typeof r.body.digest==="string"?{digest:r.body.digest}:{})}});
        }
        body={...actor,sessionId:s.id,status:"purged",version:s.revision+1,purgedAt:s.body.purgedAt??now};
        result={sessionId:s.id,version:body.version,status:"purged",cleaned:removed.length,more:candidate.more};
      }
      writes.push({...s,revision:s.revision+1,body},{...receiptKey,revision:1,body:{...actor,profile:LIFECYCLE_PROFILE,digest,result}});
      if(operation==="purgeSession") {
        let ok;try{ok=await this.lifecycleHost.authorizeRetention(bounded(actor),{session:bounded(s.body),removed:bounded(removed),writes:bounded(writes),now});}catch{fail("RETENTION_DENIED");}
        if(ok!==true)fail("RETENTION_DENIED");
      }
      let ok;try{ok=await this.host.authorizePersistence(bounded(actor),bounded(writes));}catch{fail("PERSISTENCE_DENIED");}
      if(ok!==true)fail("PERSISTENCE_DENIED");
      await access(result,s.body);
      if(!await this.backend.commit(actor.tenantId,checks,writes,Number.MAX_SAFE_INTEGER)){const winner=await replay();if(winner)return winner;fail("STATE_CONFLICT");}
      return bounded(result);
    };
    return this.coordinator?this.coordinator.run(actor,run):run();
  }
}
export class LifecycleService extends WorkflowService {
  override readonly operations:readonly Operation[]=["verify","evaluate","createSession","getSession","updateSession","getNode","createCheckpoint","resumeCheckpoint","listSessions","cancelSession","purgeSession"];
  constructor(private readonly lifecycleStore:LifecycleStore,private readonly authority:WorkflowHost){super(lifecycleStore,authority);}
  override async invoke(operation:Operation,value:unknown,token:unknown,expectedIdentity?:Principal):Promise<Record<string,unknown>> {
    if(operation!=="listSessions"&&operation!=="cancelSession"&&operation!=="purgeSession")return super.invoke(operation,value,token,expectedIdentity);
    try {
      const principal=await this.authenticate(token);
      const recheck=async()=>{const p=await this.authenticate(token);if(p.tenantId!==principal.tenantId||p.subjectId!==principal.subjectId||!p.scopes.includes(scopeFor(operation)))throw new ServiceError("FORBIDDEN",403);return p;};
      if(expectedIdentity&&(expectedIdentity.tenantId!==principal.tenantId||expectedIdentity.subjectId!==principal.subjectId))throw new ServiceError("FORBIDDEN",403);
      await recheck();
      const result=await this.lifecycleStore.lifecycle({tenantId:principal.tenantId,subjectId:principal.subjectId},operation,value,async context=>{
        const p=await recheck();const ok=await this.authority.authorize(bounded(p),context);await recheck();return ok===true;
      });
      await recheck();return {profile:LIFECYCLE_PROFILE,result};
    }catch(e){throw workflowError(e);}
  }
}
