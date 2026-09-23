// SPDX-License-Identifier: Apache-2.0
import {randomUUID} from "node:crypto";
import {performance} from "node:perf_hooks";
import {type RequestListener} from "node:http";
import {canonicalJson,parseJson,record} from "@psp-cdl/core";
import {SecurityService,ServiceError,type Principal} from "@psp-cdl/api-server";
import {McpServer,MCP_VERSION,type McpToolService} from "./server.js";

export const HTTP_LIMIT=1_048_576;
export interface McpHttpRequest {method:string;path:string;headers:readonly (readonly [string,string])[];body:Uint8Array}
export interface McpHttpResponse {status:number;headers:Record<string,string>;body:string}
export interface McpHttpConfig {endpoint:string;allowLoopbackHttp:boolean;authorizationServers:string[];maxSessions:number;sessionTtlMs:number;callTimeoutMs:number}
export interface McpHttpHost {
  /** Validate issuer, audience/resource, expiry and scopes; null means invalid token. */
  authenticate(token:string,resource:string):Principal|null|Promise<Principal|null>;
  /** Open request-local state in this worker. Select workflow identity outside RPC. */
  open(principal:Principal,cancelled:()=>boolean):{service:McpToolService;close:()=>void}|Promise<{service:McpToolService;close:()=>void}>;
}
function fail(code:string,status=400):never {throw new ServiceError(code,status);}
export function endpointUrl(value:string,allowLoopbackHttp:boolean):URL {
  let u:URL;try{u=new URL(value);}catch{return fail("INVALID_CONFIGURATION");}
  if(u.href!==value||u.username||u.password||u.search||u.hash||!/^\/[A-Za-z0-9/_-]*$/.test(u.pathname)||!(u.protocol==="https:"||allowLoopbackHttp&&u.protocol==="http:"&&["localhost","127.0.0.1","[::1]"].includes(u.hostname)))fail("INVALID_CONFIGURATION");
  return u;
}
const owner=(p:Principal)=>canonicalJson([p.tenantId,p.subjectId]);
const rpcId=(v:unknown)=>typeof v==="string"&&Buffer.byteLength(v)<=128||typeof v==="number"&&Number.isSafeInteger(v);
interface Session {owner:string;expires:number;server?:McpServer;busy:boolean;active?:unknown;cancelled:boolean;seen:Set<string>}

/** Framework-neutral, JSON-response Streamable HTTP. One active request per session. */
export class McpHttpServer {
  private readonly config:McpHttpConfig;
  private readonly url:URL;
  private readonly auth:SecurityService;
  private closed=false;
  private readonly sessions=new Map<string,Session>();
  constructor(private readonly host:McpHttpHost,config:McpHttpConfig) {
    this.config=parseJson(canonicalJson(config)) as unknown as McpHttpConfig;
    const c=this.config;
    if(Object.keys(c).sort().join(",")!=="allowLoopbackHttp,authorizationServers,callTimeoutMs,endpoint,maxSessions,sessionTtlMs"||typeof c.allowLoopbackHttp!=="boolean"||!Array.isArray(c.authorizationServers)||!c.authorizationServers.length||c.authorizationServers.length>16||!Number.isSafeInteger(c.maxSessions)||c.maxSessions<1||c.maxSessions>1024||!Number.isSafeInteger(c.sessionTtlMs)||c.sessionTtlMs<1||c.sessionTtlMs>3_600_000||!Number.isSafeInteger(c.callTimeoutMs)||c.callTimeoutMs<1||c.callTimeoutMs>30_000)fail("INVALID_CONFIGURATION");
    this.url=endpointUrl(c.endpoint,c.allowLoopbackHttp);
    for(const issuer of c.authorizationServers)endpointUrl(issuer,false);
    this.auth=new SecurityService({authenticate:t=>host.authenticate(t,c.endpoint),resolve:()=>null,now:Date.now});
  }
  private response(status:number,value?:unknown):McpHttpResponse {
    const body=value===undefined?"":canonicalJson(value);
    if(Buffer.byteLength(body)>HTTP_LIMIT)fail("RESPONSE_TOO_LARGE",500);
    return {status,body,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store","x-content-type-options":"nosniff",...(status===405?{allow:"POST, DELETE"}:{}),...(status===401?{"www-authenticate":`Bearer resource_metadata="${this.url.origin}/.well-known/oauth-protected-resource${this.url.pathname}"`}:{})}};
  }
  close():void {this.closed=true;for(const s of this.sessions.values())s.cancelled=true;this.sessions.clear();}
  async handle(request:McpHttpRequest):Promise<McpHttpResponse> {
    let initializing=false,initialized=false;
    let slot:Session|undefined, sid:string|undefined, opened:Awaited<ReturnType<McpHttpHost["open"]>>|undefined;
    try {
      if(this.closed)fail("SERVICE_CLOSED",503);
      const h=new Map<string,string>();
      for(const [name,value] of request.headers) {const k=name.toLowerCase();if(h.has(k)||/[\r\n]/.test(value))fail("INVALID_REQUEST");h.set(k,value);}
      if([...h].reduce((n,[k,v])=>n+Buffer.byteLength(k)+Buffer.byteLength(v)+4,0)>8192)fail("INVALID_REQUEST");
      if(h.get("host")!==this.url.host)fail("HOST_REJECTED",403);
      // This host API has no browser/CORS mode. Every supplied Origin is rejected.
      if(h.has("origin"))fail("ORIGIN_REJECTED",403);
      if(request.method==="GET"&&request.path==="/.well-known/oauth-protected-resource"+this.url.pathname)return this.response(200,{resource:this.config.endpoint,authorization_servers:this.config.authorizationServers,bearer_methods_supported:["header"]});
      const auth=h.get("authorization"),token=auth&&/^Bearer [\x21-\x7e]+$/i.test(auth)?auth.slice(7):null;
      const principal=await this.auth.authenticate(token);
      if(this.closed)fail("SERVICE_CLOSED",503);
      if(request.path!==this.url.pathname)fail("NOT_FOUND",404);
      if(!["POST","DELETE"].includes(request.method))fail("METHOD_NOT_ALLOWED",405);
      if(h.has("last-event-id"))fail("RESUMPTION_UNSUPPORTED");
      const version=h.get("mcp-protocol-version");if(version!==undefined&&version!==MCP_VERSION)fail("UNSUPPORTED_PROTOCOL");
      sid=h.get("mcp-session-id");
      for(const [id,s] of this.sessions)if(performance.now()>=s.expires&&!s.busy)this.sessions.delete(id);
      let existing:Session|undefined;
      if(sid!==undefined){existing=this.sessions.get(sid);if(!existing||existing.owner!==owner(principal)||performance.now()>=existing.expires)fail("NOT_FOUND",404);}
      if(request.method==="DELETE") {if(!existing)fail("SESSION_REQUIRED");existing.cancelled=true;this.sessions.delete(sid!);return this.response(200);}
      if(!/^application\/json(?:;\s*charset=utf-8)?$/i.test(h.get("content-type")??"")||h.has("content-encoding"))fail("UNSUPPORTED_MEDIA_TYPE",415);
      const accept=(h.get("accept")??"").split(",").map(v=>v.trim().toLowerCase());
      if(!accept.includes("application/json")||!accept.includes("text/event-stream"))fail("NOT_ACCEPTABLE",406);
      if(request.body.length>HTTP_LIMIT)fail("REQUEST_TOO_LARGE",413);
      let m:any;try{m=parseJson(new TextDecoder("utf-8",{fatal:true}).decode(request.body));}catch{fail("INVALID_REQUEST");}
      if(!record(m)||m.jsonrpc!=="2.0"||typeof m.method!=="string"||Object.keys(m).some(k=>!["jsonrpc","id","method","params"].includes(k))||Object.hasOwn(m,"id")&&!rpcId(m.id))fail("INVALID_REQUEST");
      if(!existing) {
        if(m.method!=="initialize"||!Object.hasOwn(m,"id"))fail("SESSION_REQUIRED");
        if(this.sessions.size>=this.config.maxSessions)fail("SESSION_CAPACITY",503);
        initializing=true;sid=randomUUID();existing={owner:owner(principal),expires:performance.now()+this.config.sessionTtlMs,busy:false,cancelled:false,seen:new Set()};this.sessions.set(sid,existing);
      }else if(m.method==="initialize")fail("ALREADY_INITIALIZED",409);
      if(m.method==="notifications/cancelled"&&!Object.hasOwn(m,"id")) {
        if(record(m.params)&&Object.keys(m.params).every(k=>["requestId","reason","_meta"].includes(k))&&(m.params.reason===undefined||typeof m.params.reason==="string")&&(m.params._meta===undefined||record(m.params._meta))&&rpcId(m.params.requestId)&&existing.active!==undefined&&canonicalJson(m.params.requestId)===canonicalJson(existing.active))existing.cancelled=true;
        return this.response(202);
      }
      if(existing.busy)fail("SESSION_BUSY",409);
      if(Object.hasOwn(m,"id")) {
        const key=canonicalJson(m.id);if(existing.seen.has(key))fail("DUPLICATE_REQUEST",409);
        if(existing.seen.size>=4096){this.sessions.delete(sid!);fail("NOT_FOUND",404);}existing.seen.add(key);
      }
      slot=existing;slot.busy=true;slot.cancelled=false;if(m.method!=="initialize")slot.active=m.id;
      const deadline=performance.now()+this.config.callTimeoutMs,s=slot;
      const cancelled=()=>s.cancelled||performance.now()>=Math.min(deadline,s.expires);
      opened=await this.host.open(parseJson(canonicalJson(principal)) as unknown as Principal,cancelled);
      if(cancelled())return this.response(204);
      // Request-local token and service never overwrite another request's context.
      slot.server??=new McpServer(this.auth,()=>{throw new Error("Request context required");});
      const result=await slot.server.handle(canonicalJson(m),{token:token!,service:opened.service,principal});
      if(cancelled())return this.response(204);
      if(owner(await this.auth.authenticate(token))!==slot.owner)fail("UNAUTHENTICATED",401);
      if(cancelled())return this.response(204);
      const response=this.response(result===null?202:200,result===null?undefined:result);
      if(m.method==="initialize") {
        if(result&&record(result.result)){initialized=true;response.headers["mcp-session-id"]=sid!;}
        else this.sessions.delete(sid!);
      }
      return response;
    }catch(e){const err=e instanceof ServiceError?e:new ServiceError("INTERNAL_ERROR",500);return this.response(err.status,{error:{code:err.code}});}
    finally {try{opened?.close();}catch{/* Host owns cleanup diagnostics. */}if(slot){slot.busy=false;delete slot.active;if(initializing&&!initialized||performance.now()>=slot.expires)this.sessions.delete(sid!);}}
  }
}

/** Attach to a host-owned HTTP(S) server. No listener is opened on import. */
export function nodeHttpHandler(adapter:McpHttpServer):RequestListener {
  return async(req,res)=>{
    const timer=setTimeout(()=>req.destroy(),5000);
    const send=(r:McpHttpResponse)=>{res.writeHead(r.status,{...r.headers,connection:"close"});res.end(r.body);};
    try {
      let length=0;const chunks:Buffer[]=[];
      for await(const chunk of req){length+=chunk.length;if(length>HTTP_LIMIT){send({status:413,headers:{"cache-control":"no-store"},body:""});return;}chunks.push(Buffer.from(chunk));}
      clearTimeout(timer);
      const headers:[string,string][]=[];
      for(let i=0;i<req.rawHeaders.length;i+=2)headers.push([req.rawHeaders[i]!,req.rawHeaders[i+1]!]);
      send(await adapter.handle({method:req.method??"",path:req.url??"",headers,body:Buffer.concat(chunks)}));
    }catch{if(!res.headersSent&&!res.destroyed){res.writeHead(500,{connection:"close"});res.end();}}
    finally{clearTimeout(timer);}
  };
}
