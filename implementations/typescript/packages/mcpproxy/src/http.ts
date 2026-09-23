// SPDX-License-Identifier: Apache-2.0
import {request as httpRequest} from "node:http";
import {request as httpsRequest} from "node:https";
import {canonicalJson,parseJson,record} from "@psp-cdl/core";
import {MCP_VERSION} from "@psp-cdl/mcp-server";
import {endpointUrl,HTTP_LIMIT} from "@psp-cdl/mcp-server/http";
import {PinnedMcpClient,PeerError,json} from "./peer.js";

export interface HttpPeerConfig {endpoint:string;allowLoopbackHttp:boolean;serverInfo:{name:string;version:string};timeoutMs:number;caPem?:string}
function fail(code:string):never {throw new PeerError(code);}
/** Finite SSE response bodies only. No event redelivery or server-initiated messages. */
export function parseSse(source:string):unknown {
  let data:string[]=[],event="",result:unknown,found=false;
  const lines=source.replace(/\r\n?/g,"\n").split("\n");
  if(source.endsWith("\n")||source.endsWith("\r"))lines.pop();
  for(const line of lines) {
    if(line==="") {
      const payload=data.join("\n");
      if(payload){if(found||event&&event!=="message")fail("INVALID_RESPONSE");result=parseJson(payload);found=true;}
      data=[];event="";continue;
    }
    if(line.startsWith(":"))continue;
    const colon=line.indexOf(":"),field=colon<0?line:line.slice(0,colon),value=colon<0?"":line.slice(colon+1).replace(/^ /,"");
    if(field==="data")data.push(value);else if(field==="event")event=value;
    else if(field!=="id"&&field!=="retry")fail("INVALID_RESPONSE");
  }
  if(data.length||!found)fail("INVALID_RESPONSE");return result;
}

/** Fixed host-selected resource, verified TLS, separate token supplier, no redirects/replay. */
export class HttpMcpClient extends PinnedMcpClient {
  private closed=false;
  private busy=false;
  private nextId=0;
  private session:string|undefined;
  private abort:AbortController|undefined;
  private constructor(private readonly config:HttpPeerConfig,private readonly credential:(resource:string)=>string|Promise<string>){super();}
  static async connect(value:HttpPeerConfig,credential:(resource:string)=>string|Promise<string>):Promise<HttpMcpClient> {
    const c=json(value) as HttpPeerConfig;
    if(!record(c)||Object.keys(c).some(k=>!["endpoint","allowLoopbackHttp","serverInfo","timeoutMs","caPem"].includes(k))||typeof c.endpoint!=="string"||typeof c.allowLoopbackHttp!=="boolean"||!record(c.serverInfo)||Object.keys(c.serverInfo).sort().join(",")!=="name,version"||typeof c.serverInfo.name!=="string"||typeof c.serverInfo.version!=="string"||!Number.isSafeInteger(c.timeoutMs)||c.timeoutMs<1||c.timeoutMs>30_000||c.caPem!==undefined&&typeof c.caPem!=="string"||typeof credential!=="function")fail("INVALID_CONFIGURATION");
    try{endpointUrl(c.endpoint,c.allowLoopbackHttp);}catch{fail("INVALID_CONFIGURATION");}
    const client=new HttpMcpClient(c,credential);
    try{await client.initialize(c.serverInfo);return client;}catch(e){client.closed=true;client.abort?.abort();throw e;}
  }
  async close():Promise<void> {
    if(!this.closed&&!this.busy&&this.session){try{await this.exchange(undefined,"DELETE");}catch{/* No replay on failed termination. */}}
    this.closed=true;this.abort?.abort();
  }
  private async exchange(message:any,method="POST",cancelled:()=>boolean=()=>false,cancellation=false):Promise<any> {
    const controller=new AbortController();if(!cancellation)this.abort=controller;
    let fault="PEER_TIMEOUT",timer:ReturnType<typeof setTimeout>,poll:ReturnType<typeof setInterval>;
    const stop=(code:string)=>{fault=code;controller.abort();};
    const aborted=new Promise<never>((_resolve,reject)=>controller.signal.addEventListener("abort",()=>reject(new PeerError(fault)),{once:true}));
    timer=setTimeout(()=>stop("PEER_TIMEOUT"),cancellation?Math.min(1000,this.config.timeoutMs):this.config.timeoutMs);
    poll=setInterval(()=>{try{if(cancelled())stop("PEER_CANCELLED");}catch{stop("PEER_CANCELLED");}},10);
    try {
      return await Promise.race([aborted,(async()=>{
        if(cancelled())fail("PEER_CANCELLED");
        const token=await this.credential(this.config.endpoint);
        if(controller.signal.aborted)fail(fault);
        if(typeof token!=="string"||!/^[\x21-\x7e]{1,4096}$/.test(token))fail("INVALID_CREDENTIAL");
        const wire=message===undefined?"":canonicalJson(json(message));
        const u=new URL(this.config.endpoint);
        return await new Promise<any>((resolve,reject)=>{
          const request=(u.protocol==="https:"?httpsRequest:httpRequest)(u,{method,agent:false,maxHeaderSize:8192,signal:controller.signal,...(this.config.caPem===undefined?{}:{ca:this.config.caPem}),rejectUnauthorized:true,headers:{authorization:"Bearer "+token,accept:"application/json, text/event-stream","content-type":"application/json","content-length":Buffer.byteLength(wire),"mcp-protocol-version":MCP_VERSION,...(this.session?{"mcp-session-id":this.session}:{})}},response=>{
            const chunks:Buffer[]=[];let length=0;
            const rejectPeer=(code:string)=>{response.destroy();reject(new PeerError(code));};
            const h=new Map<string,string>();
            for(let i=0;i<response.rawHeaders.length;i+=2){const k=response.rawHeaders[i]!.toLowerCase();if(h.has(k)){rejectPeer("INVALID_RESPONSE");return;}h.set(k,response.rawHeaders[i+1]!);}
            const status=response.statusCode??0;
            if(status>=300||status<200){rejectPeer(status===401?"PEER_UNAUTHENTICATED":status===403?"PEER_FORBIDDEN":status===404?"PEER_SESSION_EXPIRED":"PEER_HTTP_ERROR");return;}
            if(h.has("content-encoding")){rejectPeer("INVALID_RESPONSE");return;}
            const session=h.get("mcp-session-id");
            if(session!==undefined&&(!/^[\x21-\x7e]{1,128}$/.test(session)||this.session!==undefined&&session!==this.session||this.session===undefined&&message?.method!=="initialize")){rejectPeer("INVALID_SESSION");return;}
            response.on("data",(chunk:Buffer)=>{length+=chunk.length;if(length>HTTP_LIMIT)rejectPeer("FRAME_TOO_LARGE");else chunks.push(chunk);});
            response.on("error",()=>reject(new PeerError("INVALID_RESPONSE")));
            response.on("end",()=>{
              try {
                const body=new TextDecoder("utf-8",{fatal:true}).decode(Buffer.concat(chunks));
                if(method==="DELETE"){if(body)fail("INVALID_RESPONSE");resolve(undefined);return;}
                if(!Object.hasOwn(message,"id")){if(status!==202||body)fail("INVALID_RESPONSE");resolve(undefined);return;}
                if(status!==200)fail("INVALID_RESPONSE");
                const media=(h.get("content-type")??"").toLowerCase();
                const v=/^application\/json(?:;\s*charset=utf-8)?$/.test(media)?parseJson(body):/^text\/event-stream(?:;\s*charset=utf-8)?$/.test(media)?parseSse(body):fail("INVALID_RESPONSE");
                if(!record(v)||v.jsonrpc!=="2.0"||v.id!==message.id||Object.keys(v).some(k=>!["jsonrpc","id","result","error"].includes(k))||Object.hasOwn(v,"result")===Object.hasOwn(v,"error"))fail("INVALID_RESPONSE");
                if(Object.hasOwn(v,"error"))fail("REMOTE_ERROR");
                if(message.method==="initialize")this.session=session;
                resolve(v.result);
              }catch(e){reject(e instanceof PeerError?e:new PeerError("INVALID_RESPONSE"));}
            });
          });
          request.on("error",()=>reject(new PeerError(controller.signal.aborted?fault:"PEER_CONNECTION_FAILED")));
          request.end(wire);
        });
      })()]);
    }finally{clearTimeout(timer);clearInterval(poll);if(!cancellation)this.abort=undefined;controller.abort();}
  }
  protected async notify(method:string,params:unknown):Promise<void> {await this.exchange({jsonrpc:"2.0",method,params});}
  protected async request(method:string,params:unknown,cancelled:()=>boolean=()=>false):Promise<any> {
    if(this.closed)fail("PEER_CLOSED");if(this.busy)fail("PEER_BUSY");this.busy=true;
    const id=++this.nextId;
    try{return await this.exchange({jsonrpc:"2.0",id,method,params},"POST",cancelled);}
    catch(e){
      // A disconnect alone is not MCP cancellation. Send an explicit, separate notification.
      if(method!=="initialize"&&e instanceof PeerError&&["PEER_CANCELLED","PEER_TIMEOUT"].includes(e.code)) {
        try{await this.exchange({jsonrpc:"2.0",method:"notifications/cancelled",params:{requestId:id}},"POST",()=>false,true);}catch{/* Best effort; late output remains suppressed locally. */}
      }
      this.closed=true;throw e;
    }finally{this.busy=false;}
  }
}
