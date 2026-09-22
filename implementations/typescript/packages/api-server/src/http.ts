// SPDX-License-Identifier: Apache-2.0
import { createServer } from "node:http";
import { canonicalJson, parseJson } from "@psp-cdl/core";
import { MAX_REQUEST_BYTES, SecurityService, ServiceError, type Operation } from "./service.js";

export interface HttpRequest { method:string; path:string; headers:readonly (readonly [string,string])[]; body:Uint8Array }
export interface HttpResponse { status:number; headers:Record<string,string>; body:string }
const routes:Record<string,Operation>={"/v1/security/verify":"verify","/v1/policy/evaluate":"evaluate"};
export function errorResponse(error:unknown):HttpResponse {
  const e=error instanceof ServiceError?error:new ServiceError("INTERNAL_ERROR",500);
  return response(e.status,{error:{code:e.code}});
}
function response(status:number, value:unknown):HttpResponse {
  return {status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store","x-content-type-options":"nosniff",...(status===401?{"www-authenticate":'Bearer realm="psp-reference"'}:{})},body:canonicalJson(value)};
}
/** Framework-neutral handler; TLS termination and connection quotas belong to the host. */
export async function handleHttp(service:SecurityService, request:HttpRequest):Promise<HttpResponse> {
  try {
    const headers=new Map<string,string>();
    for(const [name,value] of request.headers) {
      const key=name.toLowerCase();
      if(headers.has(key)||/[\r\n]/.test(value)) throw new ServiceError("INVALID_REQUEST",400);
      headers.set(key,value);
    }
    const auth=headers.get("authorization");
    const token=auth&&/^Bearer [\x21-\x7e]+$/i.test(auth)?auth.slice(7):null;
    await service.authenticate(token);
    if(headers.has("origin")) throw new ServiceError("ORIGIN_REJECTED",403);
    if(request.method!=="POST") throw new ServiceError("METHOD_NOT_ALLOWED",405);
    if(!Object.hasOwn(routes,request.path)) throw new ServiceError("NOT_FOUND",404);
    if(!/^application\/json(?:;\s*charset=utf-8)?$/i.test(headers.get("content-type")??"")||headers.has("content-encoding")) throw new ServiceError("UNSUPPORTED_MEDIA_TYPE",415);
    if(request.body.length>MAX_REQUEST_BYTES) throw new ServiceError("REQUEST_TOO_LARGE",413);
    let input:unknown;
    try { input=parseJson(new TextDecoder("utf-8",{fatal:true}).decode(request.body)); } catch { throw new ServiceError("INVALID_REQUEST",400); }
    return response(200,await service.invoke(routes[request.path]!,input,token));
  } catch(error) { return errorResponse(error); }
}
/** Returns an unbound Node server for loopback development, with bounded HTTP reads. */
export function createHttpServer(service:SecurityService) {
  const server=createServer({maxHeaderSize:8192,requestTimeout:5000,headersTimeout:5000},async(req,res)=>{
    const send=(r:HttpResponse)=>{res.writeHead(r.status,{...r.headers,connection:"close"});res.end(r.body);};
    const expected=new Set(["localhost","127.0.0.1","[::1]"].map(host=>host+":"+req.socket.localPort));
    if(!req.headers.host||!expected.has(req.headers.host)) {send(errorResponse(new ServiceError("HOST_REJECTED",403)));return;}
    req.setTimeout(5000,()=>req.destroy());
    let length=0; const chunks:Buffer[]=[];
    try {
      for await(const chunk of req) {
        const bytes=Buffer.from(chunk); length+=bytes.length;
        if(length>MAX_REQUEST_BYTES) {send(errorResponse(new ServiceError("REQUEST_TOO_LARGE",413)));return;}
        chunks.push(bytes);
      }
      const headers:[string,string][]=[];
      for(let i=0;i<req.rawHeaders.length;i+=2) headers.push([req.rawHeaders[i]!,req.rawHeaders[i+1]!]);
      send(await handleHttp(service,{method:req.method??"",path:req.url??"",headers,body:Buffer.concat(chunks)}));
    } catch(error) { if(!res.headersSent&&!res.destroyed) send(errorResponse(error)); }
  });
  return server;
}
