// SPDX-License-Identifier: Apache-2.0
/**
 * PSP-EXFIL-0.1: keyed lexical fingerprints and optional embeddings of protected sections.
 *
 * The store never holds protected plaintext. Shingles and chunk digests are HMACs under a
 * host-owned key; embeddings are float32 vectors. Assessment output carries counts, ratios
 * and token ranges only. Scores are heuristic signals for host threat accumulation, not proof
 * that text was or was not disclosed.
 */
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { identifier } from "./service.js";

export const EXFIL_PROFILE = "PSP-EXFIL-0.1";
export const SHINGLE_TOKENS = 5;
export const WINDOW_TOKENS = 24;
export const WINDOW_STRIDE = 12;
export const MAX_POSITIONS = 16;
export const MAX_SECTION_BYTES = 262_144;
export const MAX_OUTPUT_BYTES = 1_048_576;
export const HASH_EMBEDDER_ID = "psp-exfil-hash-384-v1";
export const DEFAULT_THRESHOLDS = Object.freeze({minRunTokens:8,leakRunTokens:16,leakCoverage:0.5,leakChunks:2,leakBreadth:3,neighbors:4,maxChunks:512});
const MAX_TEXT_FIELD = 256, APP_ID = 0x50535045, BATCH = 400;
const SCHEMA = `
CREATE TABLE exfil_meta(name TEXT PRIMARY KEY, value TEXT NOT NULL) WITHOUT ROWID;
CREATE TABLE exfil_section(
  section_id TEXT PRIMARY KEY,
  application TEXT NOT NULL,
  session_id TEXT,
  section_type TEXT NOT NULL CHECK(section_type IN ('system','context')),
  version TEXT,
  label TEXT,
  token_count INTEGER NOT NULL,
  chunk_count INTEGER NOT NULL,
  expires_at INTEGER,
  created_at INTEGER NOT NULL
) WITHOUT ROWID;
CREATE INDEX exfil_section_application ON exfil_section(application, token_count);
CREATE TABLE exfil_chunk(
  chunk_id INTEGER PRIMARY KEY,
  section_id TEXT NOT NULL REFERENCES exfil_section(section_id),
  ordinal INTEGER NOT NULL,
  chunk_hash TEXT NOT NULL,
  embedding BLOB,
  UNIQUE(section_id, ordinal)
);
CREATE TABLE exfil_shingle(
  application TEXT NOT NULL,
  shingle TEXT NOT NULL,
  section_id TEXT NOT NULL REFERENCES exfil_section(section_id),
  position INTEGER NOT NULL,
  PRIMARY KEY(application, shingle, section_id, position)
) WITHOUT ROWID;
CREATE INDEX exfil_shingle_section ON exfil_shingle(section_id);
`;
const SEVERITY = {clear:0,suspicious:1,leak:2} as const;
const TOKEN = /[\p{L}\p{N}\p{M}]/u;

export type Disposition = keyof typeof SEVERITY;
export interface Embedder {
  readonly id:string;
  readonly dimensions:number;
  readonly thresholds?:{strongDistance:number;suspiciousDistance:number};
  embed(texts:string[]):ArrayLike<number>[]|Promise<ArrayLike<number>[]>;
}
export interface Thresholds {
  minRunTokens:number;leakRunTokens:number;leakCoverage:number;leakChunks:number;leakBreadth:number;neighbors:number;maxChunks:number;
  strongDistance?:number;suspiciousDistance?:number;
}
export interface ProtectedSection {
  application:string;sectionType:"system"|"context";text:string;
  sessionId?:string|null;version?:string|null;label?:string|null;expiresAt?:number|null;
}
export interface StoreOptions {
  key:Uint8Array;
  embedder?:Embedder|null;
  /** "portable" (default) keeps vectors in BLOBs; {sqliteVec} loads a host-approved sqlite-vec build and maintains a vec0 index. */
  vector?:"portable"|{sqliteVec:string};
  thresholds?:Partial<Thresholds>;
  clock?:()=>number;
}
export interface LexicalResult {disposition:Disposition;score:number;longestRunTokens:number;coverage:number;runs:number;ranges:[number,number][]}
export interface SemanticResult {disposition:Disposition;score:number;bestDistance:number|null;strongChunks:number;suspiciousChunks:number;longestRun:number}
export interface SectionAssessment {
  sectionId:string;sectionType:"system"|"context";sessionId:string|null;version:string|null;label:string|null;tokens:number;chunks:number;
  disposition:Disposition;signal:number;lexical:LexicalResult;semantic:SemanticResult|null;
}
export interface Assessment {
  profile:typeof EXFIL_PROFILE;application:string;embedder:string|null;vector:"portable"|"sqlite-vec"|null;
  disposition:Disposition;signal:number;sources:{pattern_match:number;external_classifier:number|null};
  flags:string[];complete:boolean;output:{tokens:number;chunks:number};sections:SectionAssessment[];
}

export class ExfiltrationError extends Error {
  constructor(public readonly code:string) { super(code); this.name="ExfiltrationError"; }
}
const fail=(code:string):never=>{throw new ExfiltrationError(code);};

const LONE_SURROGATE=/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
function utf8(text:unknown,limit:number):asserts text is string {
  if(typeof text!=="string"||LONE_SURROGATE.test(text)) fail("INVALID_INPUT");
  if(Buffer.byteLength(text as string,"utf8")>limit) fail("INPUT_TOO_LARGE");
}

/** Normalized tokens with code point offsets [start, end) into the original text. */
export function tokenize(text:string):[string,number,number][] {
  const out:[string,number,number][]=[];
  let raw="",start=-1,i=0;
  for(const c of text) {
    if(TOKEN.test(c)) { if(start<0) start=i; raw+=c; }
    else if(start>=0) { split(out,raw,start,i); raw=""; start=-1; }
    i++;
  }
  if(start>=0) split(out,raw,start,i);
  return out;
}
function split(out:[string,number,number][],raw:string,start:number,end:number):void {
  let piece="";
  for(const c of raw.normalize("NFKC").toLowerCase()) {
    if(TOKEN.test(c)) piece+=c;
    else if(piece) { out.push([piece,start,end]); piece=""; }
  }
  if(piece) out.push([piece,start,end]);
}

/** Token windows [start, end) for semantic chunks. */
export function windows(count:number):[number,number][] {
  if(count<=0) return [];
  if(count<=WINDOW_TOKENS) return [[0,count]];
  const starts:number[]=[];
  for(let s=0;s<count-WINDOW_TOKENS;s+=WINDOW_STRIDE) starts.push(s);
  if(starts[starts.length-1]!==count-WINDOW_TOKENS) starts.push(count-WINDOW_TOKENS);
  return starts.map(s=>[s,s+WINDOW_TOKENS]);
}

function mac(key:Uint8Array,purpose:string,payload:string):string {
  return createHmac("sha256",key).update(EXFIL_PROFILE+"\0"+purpose+"\0"+payload,"utf8").digest("hex");
}
function shingles(key:Uint8Array,tokens:string[],width:number):string[] {
  if(width<1||tokens.length<width) return [];
  const out:string[]=[];
  for(let i=0;i+width<=tokens.length;i++) out.push(mac(key,"shingle",tokens.slice(i,i+width).join(" ")).slice(0,16));
  return out;
}
function validKey(key:unknown):Uint8Array {
  if(!(key instanceof Uint8Array)||key.length<32||key.length>1024) fail("INVALID_CONFIGURATION");
  return Uint8Array.from(key as Uint8Array);
}

/** Pure lexical fingerprint used by the store and by the shared vectors. */
export function fingerprint(text:string,key:Uint8Array):{tokens:number;width:number;shingles:string[];chunks:{start:number;end:number;digest:string}[]} {
  const k=validKey(key);
  utf8(text,MAX_SECTION_BYTES);
  const tokens=tokenize(text).map(t=>t[0]), width=Math.min(SHINGLE_TOKENS,tokens.length);
  return {tokens:tokens.length,width,shingles:shingles(k,tokens,width),
    chunks:windows(tokens.length).map(([start,end])=>({start,end,digest:mac(k,"chunk",tokens.slice(start,end).join(" "))}))};
}

function fnv1a(data:Uint8Array):number {
  let h=0x811c9dc5;
  for(const b of data) h=Math.imul(h^b,0x01000193)>>>0;
  return h;
}

/** Deterministic feature-hashing embedder. Lexical similarity only; it does not model paraphrase. */
export class HashingEmbedder implements Embedder {
  readonly id=HASH_EMBEDDER_ID;
  readonly dimensions=384;
  readonly thresholds={strongDistance:0.2,suspiciousDistance:0.35};
  embed(texts:string[]):number[][] { return texts.map(t=>this.vector(t)); }
  private vector(text:string):number[] {
    const v=new Array<number>(this.dimensions).fill(0);
    const add=(feature:string,weight:number)=>{
      const h=fnv1a(Buffer.from(feature,"utf8")), i=h%this.dimensions;
      v[i]=v[i]!+((h&0x80000000)!==0?-weight:weight);
    };
    const tokens=text.split(" ");
    tokens.forEach((t,i)=>{
      add("w\0"+t,1);
      const padded=Array.from("<"+t+">");
      for(let j=0;j<Math.max(1,padded.length-2);j++) add("c\0"+padded.slice(j,j+3).join(""),0.5);
      if(i) add("b\0"+tokens[i-1]+" "+t,1);
    });
    let total=0;
    for(const x of v) total+=x*x;
    if(total===0) return v;
    const norm=Math.sqrt(total);
    return v.map(x=>x/norm);
  }
}

/** Pinned local sentence model: Xenova's ONNX export of sentence-transformers/all-MiniLM-L6-v2 (Apache-2.0). */
export const MINILM_ONNX = Object.freeze({
  repository:"Xenova/all-MiniLM-L6-v2",revision:"751bff37182d3f1213fa05d7196b954e230abad9",
  modelSha256:"759c3cd2b7fe7e93933ad23c4c9181b7396442a2ed746ec7c1d46192c469c46e",
  tokenizerSha256:"da0e79933b9ed51798a3ae27893d3c5fa4a201126cef75586296df9b4d2c62a0",
  dimensions:384,maxTokens:128
});
interface OrtTensor {readonly data:unknown;readonly dims:readonly number[]}
/** The subset of onnxruntime-node used here. The host imports and supplies the module. */
export interface OrtModule {
  InferenceSession:{create(model:Uint8Array):Promise<{run(feeds:Record<string,unknown>):Promise<Record<string,OrtTensor>>}>};
  Tensor:new(type:"int64",data:BigInt64Array,dims:number[])=>unknown;
}
/** The subset of @huggingface/tokenizers used here. The host imports and supplies the module. */
export interface TokenizersModule {Tokenizer:new(json:unknown,config:unknown)=>{encode(text:string):{ids:number[]}}}
export interface OnnxEmbedderOptions {
  modelDir:string;ort:OrtModule;tokenizers:TokenizersModule;
  modelSha256?:string;tokenizerSha256?:string;thresholds?:{strongDistance:number;suspiciousDistance:number};batchSize?:number;
}
const sha256=(bytes:Uint8Array)=>createHash("sha256").update(bytes).digest("hex");

/**
 * Local mean-pooled sentence embeddings from a pinned ONNX file. Files are read from the host's
 * directory and checked against SHA-256 digests; nothing is downloaded. Thresholds are starting
 * points from the design note and must be calibrated on benign traffic for each workflow.
 */
export async function createOnnxEmbedder(options:OnnxEmbedderOptions):Promise<Embedder> {
  if(options===null||typeof options!=="object"||typeof options.modelDir!=="string"||!options.modelDir||typeof options.ort?.InferenceSession?.create!=="function"||
    typeof options.ort?.Tensor!=="function"||typeof options.tokenizers?.Tokenizer!=="function") fail("INVALID_CONFIGURATION");
  const batchSize=options.batchSize??16;
  if(!Number.isInteger(batchSize)||batchSize<1||batchSize>256) fail("INVALID_CONFIGURATION");
  let model:Uint8Array,tokenizerJson:Uint8Array,tokenizerConfig:Uint8Array;
  try {
    model=readFileSync(join(options.modelDir,"onnx","model.onnx"));
    tokenizerJson=readFileSync(join(options.modelDir,"tokenizer.json"));
    tokenizerConfig=readFileSync(join(options.modelDir,"tokenizer_config.json"));
  } catch { return fail("EMBEDDER_UNAVAILABLE"); }
  const modelSha=sha256(model);
  if(modelSha!==(options.modelSha256??MINILM_ONNX.modelSha256)||sha256(tokenizerJson)!==(options.tokenizerSha256??MINILM_ONNX.tokenizerSha256)) fail("MODEL_MISMATCH");
  const {ort}=options;
  let session:Awaited<ReturnType<OrtModule["InferenceSession"]["create"]>>,tokenizer:InstanceType<TokenizersModule["Tokenizer"]>;
  try {
    session=await ort.InferenceSession.create(model);
    tokenizer=new options.tokenizers.Tokenizer(JSON.parse(Buffer.from(tokenizerJson).toString("utf8")),JSON.parse(Buffer.from(tokenizerConfig).toString("utf8")));
  } catch { return fail("EMBEDDER_UNAVAILABLE"); }
  const dims=MINILM_ONNX.dimensions, limit=MINILM_ONNX.maxTokens;
  const thresholds=options.thresholds??{strongDistance:0.15,suspiciousDistance:0.3};
  return {
    id:"minilm-l6-v2-onnx:"+modelSha.slice(0,16),dimensions:dims,thresholds,
    async embed(texts:string[]):Promise<number[][]> {
      const out:number[][]=[];
      for(let b=0;b<texts.length;b+=batchSize) {
        const batch=texts.slice(b,b+batchSize).map(t=>{
          const ids=tokenizer.encode(t).ids;
          // Keep [CLS] ... [SEP]; the tokenizer file's own 128-token truncation is not applied by every runtime.
          return ids.length>limit?[...ids.slice(0,limit-1),ids[ids.length-1]!]:ids;
        });
        const seq=Math.max(...batch.map(ids=>ids.length)), size=batch.length*seq;
        const inputIds=new BigInt64Array(size), mask=new BigInt64Array(size);
        batch.forEach((ids,r)=>ids.forEach((id,c)=>{ inputIds[r*seq+c]=BigInt(id); mask[r*seq+c]=1n; }));
        const result=await session.run({input_ids:new ort.Tensor("int64",inputIds,[batch.length,seq]),attention_mask:new ort.Tensor("int64",mask,[batch.length,seq]),
          token_type_ids:new ort.Tensor("int64",new BigInt64Array(size),[batch.length,seq])});
        const hidden=result.last_hidden_state;
        if(!hidden||!(hidden.data instanceof Float32Array)||hidden.dims.join()!==[batch.length,seq,dims].join()) fail("EMBEDDER_FAILED");
        const data=hidden!.data as Float32Array;
        batch.forEach((ids,r)=>{
          const mean=new Array<number>(dims).fill(0);
          for(let c=0;c<ids.length;c++) for(let d=0;d<dims;d++) mean[d]=mean[d]!+data[(r*seq+c)*dims+d]!;
          let total=0;
          for(let d=0;d<dims;d++) { mean[d]=mean[d]!/ids.length; total+=mean[d]!*mean[d]!; }
          const n=Math.sqrt(total);
          out.push(n===0?mean:mean.map(x=>x/n));
        });
      }
      return out;
    }
  };
}

function pack(vector:unknown,dimensions:number):Uint8Array {
  if(!(Array.isArray(vector)||vector instanceof Float32Array||vector instanceof Float64Array)||(vector as ArrayLike<number>).length!==dimensions) fail("EMBEDDER_FAILED");
  const bytes=new Uint8Array(4*dimensions), view=new DataView(bytes.buffer);
  for(let i=0;i<dimensions;i++) {
    const x=(vector as ArrayLike<unknown>)[i];
    if(typeof x!=="number"||!Number.isFinite(x)||!Number.isFinite(Math.fround(x))) fail("EMBEDDER_FAILED");
    view.setFloat32(4*i,x as number,true);
  }
  return bytes;
}
function unpack(blob:unknown,dimensions:number):Float64Array {
  if(!(blob instanceof Uint8Array)||blob.length!==4*dimensions) fail("STORE_CORRUPT");
  const b=blob as Uint8Array, view=new DataView(b.buffer,b.byteOffset,b.byteLength), out=new Float64Array(dimensions);
  for(let i=0;i<dimensions;i++) out[i]=view.getFloat32(4*i,true);
  return out;
}
function norm(values:Float64Array):number {
  let total=0;
  for(const x of values) total+=x*x;
  return Math.sqrt(total);
}
function distance(a:Float64Array,an:number,b:Float64Array,bn:number):number {
  if(an===0||bn===0) return 1;
  let dot=0;
  for(let i=0;i<a.length;i++) dot+=a[i]!*b[i]!;
  return Math.min(2,Math.max(0,1-dot/(an*bn)));
}
const round=(x:number):number=>Math.floor(x*1_000_000+0.5)/1_000_000;

function number(value:unknown,low:number,high:number,integer=false):number {
  if(typeof value!=="number"||!Number.isFinite(value)||value<low||value>high||integer&&!Number.isInteger(value)) fail("INVALID_CONFIGURATION");
  return value as number;
}
function thresholds(embedder:Embedder|null,override:unknown):Thresholds {
  const base:Record<string,unknown>={...DEFAULT_THRESHOLDS};
  if(embedder) Object.assign(base,embedder.thresholds??{});
  if(override!==undefined) {
    const allowed=new Set([...Object.keys(DEFAULT_THRESHOLDS),"strongDistance","suspiciousDistance"]);
    if(override===null||typeof override!=="object"||Array.isArray(override)||Object.keys(override).some(k=>!allowed.has(k))) fail("INVALID_CONFIGURATION");
    Object.assign(base,override);
  }
  for(const name of ["minRunTokens","leakRunTokens","leakChunks","leakBreadth"]) number(base[name],1,10_000,true);
  number(base.neighbors,1,64,true); number(base.maxChunks,1,100_000,true); number(base.leakCoverage,0.01,1);
  if((base.minRunTokens as number)>(base.leakRunTokens as number)) fail("INVALID_CONFIGURATION");
  if(embedder) {
    if(!("strongDistance" in base)||!("suspiciousDistance" in base)) fail("INVALID_CONFIGURATION");
    number(base.strongDistance,0,2); number(base.suspiciousDistance,0,2);
    if((base.strongDistance as number)>=(base.suspiciousDistance as number)) fail("INVALID_CONFIGURATION");
  } else { delete base.strongDistance; delete base.suspiciousDistance; }
  return Object.freeze(base) as unknown as Thresholds;
}
function optionalText(value:unknown):string|null {
  if(value===undefined||value===null) return null;
  if(typeof value!=="string"||!value||value.length>MAX_TEXT_FIELD) fail("INVALID_INPUT");
  return value as string;
}
function translated(error:unknown):ExfiltrationError {
  if(error instanceof ExfiltrationError) return error;
  const code=(error as {errcode?:number})?.errcode;
  return new ExfiltrationError(code!==undefined&&[5,6].includes(code&255)?"STORE_BUSY":"STORE_FAILURE");
}
function merge(ranges:[number,number][]):[number,number][] {
  const merged:[number,number][]=[];
  for(const [start,end] of [...ranges].sort((a,b)=>a[0]-b[0]||a[1]-b[1])) {
    const last=merged[merged.length-1];
    if(last&&start<=last[1]) last[1]=Math.max(last[1],end); else merged.push([start,end]);
  }
  return merged;
}
const byText=(a:string,b:string)=>a<b?-1:a>b?1:0;
const worst=(values:Disposition[]):Disposition=>values.reduce<Disposition>((w,v)=>SEVERITY[v]>SEVERITY[w]?v:w,"clear");

interface Info {sessionId:string|null;sectionType:"system"|"context";version:string|null;label:string|null;tokens:number;chunks:number}
type Ranked=[number,string,number];

/** One SQLite file of protected-section fingerprints. One connection per worker; shared Node/Python format. */
export class ExfiltrationStore {
  readonly vector:"portable"|"sqlite-vec";
  readonly thresholds:Thresholds;
  private readonly db:DatabaseSync;
  private readonly key:Uint8Array;
  private readonly embedder:Embedder|null;
  private readonly clock:()=>number;
  private readonly indexed:boolean;
  private readonly cache=new Map<string,{version:string;chunks:[string,number,Float64Array,number][]}>();
  private writes=0;
  constructor(path:string,options:StoreOptions) {
    if(typeof path!=="string"||!path||path.includes("\0")||path.startsWith("file:")||path===":memory:"||options===null||typeof options!=="object"||
      Object.keys(options).some(k=>!["key","embedder","vector","thresholds","clock"].includes(k))||options.clock!==undefined&&typeof options.clock!=="function") fail("INVALID_CONFIGURATION");
    this.key=validKey(options.key);
    const embedder=options.embedder??null;
    if(embedder&&(typeof embedder.embed!=="function"||!identifier(embedder.id)||!Number.isInteger(embedder.dimensions)||embedder.dimensions<1||embedder.dimensions>4096)) fail("INVALID_CONFIGURATION");
    this.embedder=embedder;
    this.thresholds=thresholds(embedder,options.thresholds);
    let extension:string|null=null;
    const vector=options.vector;
    if(vector===undefined||vector==="portable") extension=null;
    else if(vector!==null&&typeof vector==="object"&&Object.keys(vector).join()==="sqliteVec"&&typeof vector.sqliteVec==="string"&&vector.sqliteVec&&embedder) extension=vector.sqliteVec;
    else fail("INVALID_CONFIGURATION");
    this.vector=extension?"sqlite-vec":"portable";
    this.clock=options.clock??(()=>Math.floor(Date.now()/1000));
    let db:DatabaseSync|undefined;
    try {
      db=new DatabaseSync(path,extension?{allowExtension:true}:{}); this.db=db;
      if(extension) {
        // A host-approved native library; never a model-visible or user-supplied path.
        try { db.loadExtension(extension); db.enableLoadExtension(false); } catch { fail("VECTOR_UNAVAILABLE"); }
      }
      db.exec("PRAGMA busy_timeout=5000; PRAGMA synchronous=FULL;");
      db.exec("BEGIN IMMEDIATE");
      const app=db.prepare("PRAGMA application_id").get()?.application_id;
      const version=db.prepare("PRAGMA user_version").get()?.user_version;
      const check=mac(this.key,"check",""), dims=embedder?String(embedder.dimensions):"0";
      if(app===0&&version===0&&db.prepare("SELECT name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'").all().length===0) {
        db.exec(SCHEMA);
        const put=db.prepare("INSERT INTO exfil_meta(name, value) VALUES(?, ?)");
        for(const [name,value] of [["profile",EXFIL_PROFILE],["keyCheck",check],["embedder",embedder?.id??""],["dimensions",dims]] as const) put.run(name,value);
        db.exec(`PRAGMA application_id=${APP_ID}; PRAGMA user_version=1;`);
      } else if(app!==APP_ID||version!==1) fail("UNSUPPORTED_SCHEMA");
      const meta=new Map(db.prepare("SELECT name, value FROM exfil_meta").all().map(r=>[r.name as string,r.value as string]));
      if(meta.get("profile")!==EXFIL_PROFILE) fail("UNSUPPORTED_SCHEMA");
      const stored=Buffer.from(meta.get("keyCheck")??"","utf8"), expected=Buffer.from(check,"utf8");
      if(stored.length!==expected.length||!timingSafeEqual(stored,expected)) fail("KEY_MISMATCH");
      if(meta.get("embedder")!==(embedder?.id??"")||meta.get("dimensions")!==dims) fail("EMBEDDER_MISMATCH");
      let indexed=db.prepare("SELECT 1 AS found FROM sqlite_master WHERE name='exfil_vec'").get()!==undefined;
      if(extension) {
        if(!indexed) {
          db.exec(`CREATE VIRTUAL TABLE exfil_vec USING vec0(chunk_id INTEGER PRIMARY KEY, application TEXT PARTITION KEY, embedding FLOAT[${embedder!.dimensions}] distance_metric=cosine)`);
          indexed=true; meta.set("vectorIndex","stale");
        }
        if(meta.get("vectorIndex")!=="current") {
          db.exec("DELETE FROM exfil_vec");
          db.exec("INSERT INTO exfil_vec(chunk_id, application, embedding) SELECT c.chunk_id, s.application, c.embedding FROM exfil_chunk c JOIN exfil_section s ON s.section_id=c.section_id");
          db.exec("INSERT INTO exfil_meta(name, value) VALUES('vectorIndex', 'current') ON CONFLICT(name) DO UPDATE SET value=excluded.value");
        }
      }
      this.indexed=indexed;
      db.exec("COMMIT");
    } catch(e) { try { db?.close(); } catch {} throw translated(e); }
  }
  get embedderId():string|null { return this.embedder?.id??null; }
  close():void { this.db.close(); }

  private async embed(texts:string[]):Promise<Uint8Array[]> {
    if(!texts.length) return [];
    let vectors:unknown;
    try { vectors=await this.embedder!.embed([...texts]); } catch(e) { if(e instanceof ExfiltrationError) throw e; return fail("EMBEDDER_FAILED"); }
    if(!Array.isArray(vectors)||vectors.length!==texts.length) fail("EMBEDDER_FAILED");
    return (vectors as unknown[]).map(v=>pack(v,this.embedder!.dimensions));
  }
  private write<T>(fn:()=>T):T {
    try {
      this.db.exec("BEGIN IMMEDIATE");
      let result:T;
      try {
        result=fn();
        if(this.indexed&&this.vector==="portable") this.db.exec("INSERT INTO exfil_meta(name, value) VALUES('vectorIndex', 'stale') ON CONFLICT(name) DO UPDATE SET value=excluded.value");
        this.db.exec("COMMIT");
      } catch(e) { try { this.db.exec("ROLLBACK"); } catch {} throw e; }
      this.writes++;
      return result;
    } catch(e) { throw translated(e); }
  }

  /** Register a protected SYSTEM or CONTEXT body. Idempotent per application, session, type and normalized text. */
  async protect(section:ProtectedSection):Promise<{sectionId:string;created:boolean;tokens:number;shingles:number;chunks:number}> {
    const fields=section!==null&&typeof section==="object"?Object.keys(section):[];
    if(!fields.length||fields.some(k=>!["application","sectionType","text","sessionId","version","label","expiresAt"].includes(k))||!["application","sectionType","text"].every(k=>fields.includes(k))) fail("INVALID_INPUT");
    const {application,sectionType}=section, sessionId=section.sessionId??null;
    if(!identifier(application)||sessionId!==null&&!identifier(sessionId)||!["system","context"].includes(sectionType)) fail("INVALID_INPUT");
    const version=optionalText(section.version), label=optionalText(section.label), expires=section.expiresAt??null;
    if(expires!==null&&(!Number.isSafeInteger(expires)||expires<0)) fail("INVALID_INPUT");
    utf8(section.text,MAX_SECTION_BYTES);
    const tokens=tokenize(section.text).map(t=>t[0]);
    if(!tokens.length) fail("INVALID_INPUT");
    const sectionId=mac(this.key,"section",[application,sessionId??"",sectionType,tokens.join(" ")].join("\0"));
    const hashes=shingles(this.key,tokens,Math.min(SHINGLE_TOKENS,tokens.length));
    const spans=windows(tokens.length), texts=spans.map(([s,e])=>tokens.slice(s,e).join(" "));
    const embeddings=this.embedder?await this.embed(texts):texts.map(()=>null);
    const now=this.clock();
    if(!Number.isSafeInteger(now)) fail("INVALID_CLOCK");
    const created=this.write(()=>{
      if(this.db.prepare("SELECT 1 AS found FROM exfil_section WHERE section_id=?").get(sectionId)) {
        this.db.prepare("UPDATE exfil_section SET version=?, label=?, expires_at=? WHERE section_id=?").run(version,label,expires,sectionId);
        return false;
      }
      this.db.prepare("INSERT INTO exfil_section(section_id, application, session_id, section_type, version, label, token_count, chunk_count, expires_at, created_at) VALUES(?,?,?,?,?,?,?,?,?,?)")
        .run(sectionId,application,sessionId,sectionType,version,label,tokens.length,spans.length,expires,now);
      const put=this.db.prepare("INSERT INTO exfil_shingle(application, shingle, section_id, position) VALUES(?,?,?,?)"), seen=new Map<string,number>();
      hashes.forEach((h,position)=>{
        const n=seen.get(h)??0;
        if(n<MAX_POSITIONS) { seen.set(h,n+1); put.run(application,h,sectionId,position); }
      });
      const chunk=this.db.prepare("INSERT INTO exfil_chunk(section_id, ordinal, chunk_hash, embedding) VALUES(?,?,?,?)");
      const indexRow=this.vector==="sqlite-vec"?this.db.prepare("INSERT INTO exfil_vec(chunk_id, application, embedding) VALUES(?,?,?)"):null;
      texts.forEach((text,ordinal)=>{
        const blob=embeddings[ordinal]??null;
        const id=chunk.run(sectionId,ordinal,mac(this.key,"chunk",text),blob).lastInsertRowid;
        if(blob&&indexRow) indexRow.run(BigInt(id),application,blob);
      });
      return true;
    });
    return {sectionId,created,tokens:tokens.length,shingles:hashes.length,chunks:spans.length};
  }

  private delete(where:string,args:(string|number)[]):number {
    const ids=this.db.prepare("SELECT section_id FROM exfil_section WHERE "+where).all(...args).map(r=>r.section_id as string);
    for(const id of ids) {
      if(this.vector==="sqlite-vec") this.db.prepare("DELETE FROM exfil_vec WHERE chunk_id IN (SELECT chunk_id FROM exfil_chunk WHERE section_id=?)").run(id);
      for(const table of ["exfil_chunk","exfil_shingle","exfil_section"]) this.db.prepare(`DELETE FROM ${table} WHERE section_id=?`).run(id);
    }
    return ids.length;
  }
  remove(sectionId:string):boolean {
    if(typeof sectionId!=="string"||sectionId.length!==64) fail("INVALID_INPUT");
    return this.write(()=>this.delete("section_id=?",[sectionId]))===1;
  }
  removeSession(application:string,sessionId:string):number {
    if(!identifier(application)||!identifier(sessionId)) fail("INVALID_INPUT");
    return this.write(()=>this.delete("application=? AND session_id=?",[application,sessionId]));
  }
  /** Delete sections whose expiresAt is at or before now. */
  purge(now:number=this.clock()):number {
    if(!Number.isSafeInteger(now)) fail("INVALID_INPUT");
    return this.write(()=>this.delete("expires_at IS NOT NULL AND expires_at<=?",[now]));
  }
  sections(application:string):{sectionId:string;sessionId:string|null;sectionType:string;version:string|null;label:string|null;tokens:number;chunks:number;expiresAt:number|null;createdAt:number}[] {
    if(!identifier(application)) fail("INVALID_INPUT");
    try {
      return this.db.prepare("SELECT section_id, session_id, section_type, version, label, token_count, chunk_count, expires_at, created_at FROM exfil_section WHERE application=? ORDER BY section_id").all(application)
        .map(r=>({sectionId:r.section_id as string,sessionId:r.session_id as string|null,sectionType:r.section_type as string,version:r.version as string|null,label:r.label as string|null,
          tokens:r.token_count as number,chunks:r.chunk_count as number,expiresAt:r.expires_at as number|null,createdAt:r.created_at as number}));
    } catch(e) { throw translated(e); }
  }

  /** Compare outbound text with every protected section of one application. */
  async assess(request:{application:string;text:string}):Promise<Assessment> {
    if(request===null||typeof request!=="object"||Object.keys(request).sort().join()!=="application,text"||!identifier(request.application)) fail("INVALID_INPUT");
    utf8(request.text,MAX_OUTPUT_BYTES);
    const {application}=request, th=this.thresholds;
    const tokens=tokenize(request.text).map(t=>t[0]);
    let spans=windows(tokens.length);
    const complete=spans.length<=th.maxChunks;
    spans=spans.slice(0,th.maxChunks);
    let info:Map<string,Info>, lexical:Map<string,LexicalResult>, semantic=new Map<string,SemanticResult>();
    try {
      info=new Map(this.db.prepare("SELECT section_id, session_id, section_type, version, label, token_count, chunk_count FROM exfil_section WHERE application=?").all(application)
        .map(r=>[r.section_id as string,{sessionId:r.session_id as string|null,sectionType:r.section_type as "system"|"context",version:r.version as string|null,label:r.label as string|null,tokens:r.token_count as number,chunks:r.chunk_count as number}]));
      lexical=this.lexical(application,tokens,info);
    } catch(e) { throw translated(e); }
    if(this.embedder&&spans.length&&info.size) {
      const outbound=await this.embed(spans.map(([s,e])=>tokens.slice(s,e).join(" ")));
      try { semantic=this.semantic(application,outbound,info); } catch(e) { throw translated(e); }
    }
    const sections:SectionAssessment[]=[];
    for(const sectionId of [...new Set([...lexical.keys(),...semantic.keys()])].sort(byText)) {
      const meta=info.get(sectionId)!;
      const lex=lexical.get(sectionId)??{disposition:"clear",score:0,longestRunTokens:0,coverage:0,runs:0,ranges:[]};
      const sem=this.embedder?semantic.get(sectionId)??{disposition:"clear",score:0,bestDistance:null,strongChunks:0,suspiciousChunks:0,longestRun:0}:null;
      sections.push({sectionId,sectionType:meta.sectionType,sessionId:meta.sessionId,version:meta.version,label:meta.label,tokens:meta.tokens,chunks:meta.chunks,
        disposition:worst([lex.disposition,sem?.disposition??"clear"]),signal:Math.max(lex.score,sem?.score??0),lexical:lex,semantic:sem});
    }
    sections.sort((a,b)=>b.signal-a.signal||byText(a.sectionId,b.sectionId));
    const flags=new Set<string>();
    for(const s of sections) {
      if(s.disposition==="leak") flags.add(s.sectionType==="system"?"system_prompt_disclosure":"context_disclosure");
      else if(s.disposition==="suspicious") flags.add("protected_content_overlap");
    }
    if(!complete) flags.add("assessment_incomplete");
    const lexicalMax=Math.max(0,...sections.map(s=>s.lexical.score));
    const semanticMax=this.embedder?Math.max(0,...sections.map(s=>s.semantic!.score)):null;
    return {profile:EXFIL_PROFILE,application,embedder:this.embedderId,vector:this.embedder?this.vector:null,
      disposition:worst(sections.map(s=>s.disposition)),signal:Math.max(lexicalMax,semanticMax??0),sources:{pattern_match:lexicalMax,external_classifier:semanticMax},
      flags:[...flags].sort(byText),complete,output:{tokens:tokens.length,chunks:spans.length},sections};
  }

  private lexical(application:string,tokens:string[],info:Map<string,Info>):Map<string,LexicalResult> {
    const widths=[...new Set([...info.values()].map(m=>Math.min(SHINGLE_TOKENS,m.tokens)))].sort((a,b)=>a-b);
    const occurrences=new Map<string,number[]>();
    for(const width of widths) shingles(this.key,tokens,width).forEach((h,i)=>{
      const found=occurrences.get(h)??[];
      if(found.length<MAX_POSITIONS) found.push(i);
      occurrences.set(h,found);
    });
    const pairs=new Map<string,Set<number>>(), hashes=[...occurrences.keys()].sort(byText);
    for(let b=0;b<hashes.length;b+=BATCH) {
      const batch=hashes.slice(b,b+BATCH);
      const rows=this.db.prepare("SELECT shingle, section_id, position FROM exfil_shingle WHERE application=? AND shingle IN ("+batch.map(()=>"?").join(",")+")").all(application,...batch);
      for(const r of rows) {
        const sectionId=r.section_id as string;
        if(!info.has(sectionId)) continue;
        const target=pairs.get(sectionId)??new Set<number>();
        for(const i of occurrences.get(r.shingle as string)!) target.add(pair(i,r.position as number));
        pairs.set(sectionId,target);
      }
    }
    const th=this.thresholds, result=new Map<string,LexicalResult>();
    for(const [sectionId,found] of pairs) {
      const n=info.get(sectionId)!.tokens, width=Math.min(SHINGLE_TOKENS,n);
      const qualify=Math.min(th.minRunTokens,n), target=Math.min(th.leakRunTokens,n);
      const runs:number[]=[], covered=new Set<number>(), ranges:[number,number][]=[];
      for(const key of [...found].sort((a,b)=>a-b)) {
        const i=Math.floor(key/PAIR), j=key%PAIR;
        if(i>0&&j>0&&found.has(pair(i-1,j-1))) continue;
        let length=1;
        while(found.has(pair(i+length,j+length))) length++;
        const size=length+width-1;
        if(size>=qualify) { runs.push(size); for(let t=j;t<j+size;t++) covered.add(t); ranges.push([i,i+size]); }
      }
      if(!runs.length) continue;
      const longest=Math.max(...runs), share=covered.size/n;
      const leak=longest>=target||share>=th.leakCoverage;
      result.set(sectionId,{disposition:leak?"leak":"suspicious",score:leak?1:round(Math.min(1,Math.max(longest/target,share/th.leakCoverage))),
        longestRunTokens:longest,coverage:round(share),runs:runs.length,ranges:merge(ranges).slice(0,32)});
    }
    return result;
  }

  private semantic(application:string,outbound:Uint8Array[],info:Map<string,Info>):Map<string,SemanticResult> {
    const th=this.thresholds, dims=this.embedder!.dimensions, hits=new Map<string,[number,number][]>();
    if(this.vector==="sqlite-vec") {
      const names=new Map<number,[string,number]>();
      const knn=this.db.prepare("SELECT chunk_id, distance FROM exfil_vec WHERE embedding MATCH ? AND k = ? AND application = ?");
      for(const blob of outbound) {
        // node:sqlite binds JS numbers as REAL; vec0 requires an integer k.
        const rows=knn.all(blob,BigInt(th.neighbors),application).map(r=>[Number(r.chunk_id),Number(r.distance)] as [number,number]);
        const missing=rows.map(r=>r[0]).filter(id=>!names.has(id));
        for(let b=0;b<missing.length;b+=BATCH) {
          const part=missing.slice(b,b+BATCH);
          for(const r of this.db.prepare("SELECT chunk_id, section_id, ordinal FROM exfil_chunk WHERE chunk_id IN ("+part.map(()=>"?").join(",")+")").all(...part))
            names.set(Number(r.chunk_id),[r.section_id as string,r.ordinal as number]);
        }
        this.hits(hits,rows.map(([id,d])=>[Math.min(2,Math.max(0,d)),names.get(id)![0],names.get(id)![1]] as Ranked).sort(ranked),info);
      }
    } else {
      const chunks=this.chunks(application,dims);
      for(const blob of outbound) {
        const values=unpack(blob,dims), n=norm(values);
        this.hits(hits,chunks.map(([sid,ordinal,vec,vn])=>[distance(values,n,vec,vn),sid,ordinal] as Ranked).sort(ranked).slice(0,th.neighbors),info);
      }
    }
    const result=new Map<string,SemanticResult>();
    for(const [sectionId,found] of hits) {
      const chunks=info.get(sectionId)!.chunks;
      const strong=[...new Set(found.filter(([,d])=>d<=th.strongDistance!).map(([o])=>o))].sort((a,b)=>a-b);
      const best=Math.min(...found.map(([,d])=>d));
      let longest=0,run=0;
      strong.forEach((ordinal,k)=>{ run=k&&strong[k-1]===ordinal-1?run+1:1; longest=Math.max(longest,run); });
      const breadth=new Set(found.map(([o])=>o)).size;
      const leak=strong.length>0&&(longest>=Math.min(th.leakChunks,chunks)||strong.length/chunks>=th.leakCoverage)||breadth>=th.leakBreadth;
      const closeness=Math.min(1,Math.max(0,(th.suspiciousDistance!-best)/(th.suspiciousDistance!-th.strongDistance!)));
      result.set(sectionId,{disposition:leak?"leak":"suspicious",score:leak?1:round(0.25+0.5*closeness),bestDistance:round(best),
        strongChunks:strong.length,suspiciousChunks:breadth,longestRun:longest});
    }
    return result;
  }
  private hits(hits:Map<string,[number,number][]>,ranked:Ranked[],info:Map<string,Info>):void {
    for(const [d,sectionId,ordinal] of ranked.slice(0,this.thresholds.neighbors)) {
      if(d<=this.thresholds.suspiciousDistance!&&info.has(sectionId)) { const found=hits.get(sectionId)??[]; found.push([ordinal,d]); hits.set(sectionId,found); }
    }
  }
  private chunks(application:string,dims:number):[string,number,Float64Array,number][] {
    const version=String(this.db.prepare("PRAGMA data_version").get()?.data_version)+":"+this.writes;
    const cached=this.cache.get(application);
    if(cached&&cached.version===version) return cached.chunks;
    const chunks=this.db.prepare("SELECT c.section_id, c.ordinal, c.embedding FROM exfil_chunk c JOIN exfil_section s ON s.section_id=c.section_id WHERE s.application=? ORDER BY c.section_id, c.ordinal").all(application)
      .map(r=>{ const values=unpack(r.embedding,dims); return [r.section_id as string,r.ordinal as number,values,norm(values)] as [string,number,Float64Array,number]; });
    this.cache.set(application,{version,chunks});
    return chunks;
  }
}
const PAIR=1_048_576;
const pair=(i:number,j:number)=>i*PAIR+j;
const ranked=(a:Ranked,b:Ranked)=>a[0]-b[0]||byText(a[1],b[1])||a[2]-b[2];
