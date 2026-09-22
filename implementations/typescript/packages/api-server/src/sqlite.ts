// SPDX-License-Identifier: Apache-2.0
import { DatabaseSync } from "node:sqlite";
import { canonicalJson, parseJson, record } from "@psp-cdl/core";
import { identifier } from "./service.js";
import { bounded, integer, StoreError, validateBatch, type AtomicBackend, type Comparison, type Key, type StoredRecord } from "./persistence.js";
import { STORAGE_SCHEMA } from "./storage-schema.js";

const APP_ID=1347637297;
function translated(error:unknown):StoreError {
  if(error instanceof StoreError) return error;
  const code=(error as {errcode?:number})?.errcode;
  return new StoreError(code!==undefined&&[5,6].includes(code&255)?"STORE_BUSY":"STORE_FAILURE");
}
/** Synchronous SQLite I/O. Use a worker for latency-sensitive servers. */
export class SqliteBackend implements AtomicBackend {
  private readonly db:DatabaseSync;
  constructor(path:string, public readonly epoch:string, private readonly clock:()=>number=()=>Math.floor(Date.now()/1000)) {
    if(!identifier(epoch)||typeof path!=="string"||!path||path.includes("\0")||path.startsWith("file:")||path===":memory:"||typeof clock!=="function") throw new StoreError("INVALID_CONFIGURATION");
    let db:DatabaseSync|undefined;
    try {
      db=new DatabaseSync(path); this.db=db;
      const initialApp=db.prepare("PRAGMA application_id").get()?.application_id;
      const initialVersion=db.prepare("PRAGMA user_version").get()?.user_version;
      const empty=initialApp===0&&initialVersion===0&&db.prepare("SELECT name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'").all().length===0;
      if(!empty&&(initialApp!==APP_ID||initialVersion!==1)) throw new StoreError("UNSUPPORTED_SCHEMA");
      db.exec("PRAGMA busy_timeout=5000; PRAGMA synchronous=FULL;");
      const mode=db.prepare("PRAGMA journal_mode=DELETE").get();
      if(mode?.journal_mode!=="delete") throw new StoreError("INVALID_CONFIGURATION");
      db.exec("BEGIN IMMEDIATE");
      const app=db.prepare("PRAGMA application_id").get()?.application_id;
      const version=db.prepare("PRAGMA user_version").get()?.user_version;
      if(app===0&&version===0&&db.prepare("SELECT name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'").all().length===0) {
        db.exec(STORAGE_SCHEMA); db.exec(`PRAGMA application_id=${APP_ID}; PRAGMA user_version=1;`);
      } else if(app!==APP_ID||version!==1) throw new StoreError("UNSUPPORTED_SCHEMA");
      db.exec("COMMIT");
    } catch(e) { try { db?.close(); } catch {} throw translated(e); }
  }
  now():number { const n=this.clock(); if(!integer(n)) throw new StoreError("INVALID_CLOCK"); return n; }
  read(tenantId:string,key:Key):StoredRecord|null {
    if(!identifier(tenantId)||!identifier(key.id)||!["node","session","checkpoint","receipt"].includes(key.kind)) throw new StoreError("INVALID_STATE");
    try {
      const r=this.db.prepare("SELECT revision,body FROM psp_records WHERE epoch=? AND tenant_id=? AND kind=? AND record_key=?").get(this.epoch,tenantId,key.kind,key.id);
      if(!r) return null;
      const body=parseJson(r.body as string);
      if(!record(body)||!integer(r.revision)||r.revision<1) throw new StoreError("STORE_CORRUPT");
      return {kind:key.kind,id:key.id,revision:r.revision,body:bounded(body)};
    } catch(e) { throw translated(e); }
  }
  commit(tenantId:string,checks:Comparison[],writes:StoredRecord[],expiresAt:number):boolean {
    [checks,writes]=bounded([checks,writes]);
    validateBatch(tenantId,checks,writes,expiresAt);
    let begun=false;
    try {
      this.db.exec("BEGIN IMMEDIATE"); begun=true;
      for(const c of checks) {
        const current=this.read(tenantId,c);
        if((current?.revision??null)!==c.revision) { this.db.exec("ROLLBACK"); begun=false; return false; }
      }
      const put=this.db.prepare("INSERT INTO psp_records(epoch,tenant_id,kind,record_key,revision,body) VALUES(?,?,?,?,?,?) ON CONFLICT(epoch,tenant_id,kind,record_key) DO UPDATE SET revision=excluded.revision,body=excluded.body");
      for(const w of writes) put.run(this.epoch,tenantId,w.kind,w.id,w.revision,canonicalJson(w.body));
      if(this.now()>=expiresAt) throw new StoreError("EXPIRED");
      this.db.exec("COMMIT"); begun=false; return true;
    } catch(e) {
      if(begun) { try { this.db.exec("ROLLBACK"); } catch {} }
      throw translated(e);
    }
  }
  close():void { try { this.db.close(); } catch(e) { throw translated(e); } }
}
