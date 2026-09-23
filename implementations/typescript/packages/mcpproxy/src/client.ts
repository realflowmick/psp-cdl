// SPDX-License-Identifier: Apache-2.0
import {spawn,type ChildProcessWithoutNullStreams} from "node:child_process";
import {isAbsolute} from "node:path";
import {canonicalJson,parseJson,record} from "@psp-cdl/core";
import {MCP_VERSION} from "@psp-cdl/mcp-server";
import {bounded} from "@psp-cdl/api-server/persistence";
import {type ToolRegistration,bindingDigest} from "./dispatch.js";

const LIMIT=1_048_576;
export class PeerError extends Error {constructor(public readonly code:string){super(code);this.name="PeerError";}}
export interface StdioPeerConfig {
  executable:string; args:string[]; env:Record<string,string>;
  serverInfo:{name:string;version:string}; timeoutMs:number;
}
type Approval=Omit<ToolRegistration,"server"|"invoke">;
const fail=(code:string):never=>{throw new PeerError(code);};
function json(value:unknown):any {try{return bounded(value);}catch{return fail("INVALID_PEER_DATA");}}

/** Dedicated host-launched process. No shell, inherited credentials, retries or reconnect. */
export class StdioMcpClient {
  private readonly child:ChildProcessWithoutNullStreams;
  private readonly exited:Promise<void>;
  private closed=false;
  private fault:string|undefined;
  private pending: {id:number;resolve:(v:any)=>void;reject:(e:Error)=>void}|undefined;
  private nextId=0;
  private bytes=Buffer.alloc(0);
  private catalog:Record<string,unknown>[]=[];
  private fingerprint="";
  get catalogDigest():string{return this.fingerprint;}
  private constructor(private readonly config:StdioPeerConfig) {
    this.child=spawn(config.executable,config.args,{env:config.env,shell:false,windowsHide:true,stdio:["pipe","pipe","pipe"]});
    this.exited=new Promise(resolve=>{this.child.once("close",()=>{this.stop("PEER_CLOSED");resolve();});this.child.once("error",()=>{this.stop("PEER_CLOSED");resolve();});});
    // Diagnostics are untrusted and never forwarded to callers or model-visible output.
    this.child.stderr.resume();
    this.child.stdin.on("error",()=>this.stop("PEER_CLOSED"));
    this.child.stdout.on("error",()=>this.stop("PEER_CLOSED"));
    this.child.stdout.on("data",(chunk:Buffer)=>this.receive(chunk));
  }
  static async connect(configValue:StdioPeerConfig):Promise<StdioMcpClient> {
    const c=json(configValue) as StdioPeerConfig;
    if(!record(c)||Object.keys(c).sort().join(",")!=="args,env,executable,serverInfo,timeoutMs"||!record(c.serverInfo)||Object.keys(c.serverInfo).sort().join(",")!=="name,version")fail("INVALID_CONFIGURATION");
    if(!record(c)||typeof c.executable!=="string"||!isAbsolute(c.executable)||!Array.isArray(c.args)||c.args.some(v=>typeof v!=="string"||v.includes("\0"))||!record(c.env)||Object.entries(c.env).some(([k,v])=>typeof v!=="string"||!k||/[=\0]/.test(k)||v.includes("\0"))||!record(c.serverInfo)||typeof c.serverInfo.name!=="string"||typeof c.serverInfo.version!=="string"||!Number.isSafeInteger(c.timeoutMs)||c.timeoutMs<1||c.timeoutMs>30_000) fail("INVALID_CONFIGURATION");
    const peer=new StdioMcpClient(c);
    try {
      const init=await peer.request("initialize",{protocolVersion:MCP_VERSION,capabilities:{},clientInfo:{name:"psp-cdl-mcpproxy",version:"0.1.0"}});
      if(!record(init)||init.protocolVersion!==MCP_VERSION||!record(init.serverInfo)||init.serverInfo.name!==c.serverInfo.name||init.serverInfo.version!==c.serverInfo.version||!record(init.capabilities)||!record(init.capabilities.tools)) fail("INVALID_INITIALIZATION");
      await peer.notify("notifications/initialized",{});
      peer.catalog=await peer.discover();peer.fingerprint=bindingDigest(peer.catalog);
      return peer;
    }catch(e){await peer.close();throw e;}
  }
  private stop(code:string):void {
    if(!this.fault)this.fault=code;
    this.closed=true;
    const pending=this.pending;this.pending=undefined;
    pending?.reject(new PeerError(this.fault));
    if(this.child.exitCode===null&&!this.child.killed)this.child.kill("SIGKILL");
  }
  async close():Promise<void> {this.stop("PEER_CLOSED");await this.exited;}
  private receive(chunk:Buffer):void {
    if(this.closed)return;
    let start=0;
    try {
      while(start<chunk.length) {
        const newline=chunk.indexOf(10,start),end=newline<0?chunk.length:newline;
        if(this.bytes.length+end-start>LIMIT)fail("FRAME_TOO_LARGE");
        this.bytes=Buffer.concat([this.bytes,chunk.subarray(start,end)]);
        if(newline<0)return;
        const value=parseJson(new TextDecoder("utf-8",{fatal:true}).decode(this.bytes));
        this.bytes=Buffer.alloc(0);start=newline+1;
        // Notifications invalidate this deliberately static connection. No raw relay.
        const pending=this.pending;
        if(!record(value)||value.jsonrpc!=="2.0"||!pending||value.id!==pending.id||Object.keys(value).some(k=>!["jsonrpc","id","result","error"].includes(k))||Object.hasOwn(value,"result")===Object.hasOwn(value,"error"))throw new PeerError("INVALID_RESPONSE");
        if(Object.hasOwn(value,"error"))fail("REMOTE_ERROR");
        this.pending=undefined;pending.resolve(value.result);
      }
    }catch(e){this.stop(e instanceof PeerError?e.code:"INVALID_RESPONSE");}
  }
  private async notify(method:string,params:unknown):Promise<void> {
    if(this.closed)fail(this.fault!);
    await new Promise<void>((resolve,reject)=>{
      const timer=setTimeout(()=>{this.stop("PEER_TIMEOUT");reject(new PeerError("PEER_TIMEOUT"));},this.config.timeoutMs);
      this.child.stdin.write(canonicalJson({jsonrpc:"2.0",method,params})+"\n",e=>{clearTimeout(timer);if(e){this.stop("PEER_CLOSED");reject(new PeerError("PEER_CLOSED"));}else resolve();});
    });
  }
  private async request(method:string,params:unknown,cancelled:()=>boolean=()=>false):Promise<any> {
    if(this.closed)fail(this.fault!);
    if(this.pending)fail("PEER_BUSY");
    if(cancelled())fail("PEER_CANCELLED");
    const id=++this.nextId, wire=canonicalJson(json({jsonrpc:"2.0",id,method,params}))+"\n";
    let timer:ReturnType<typeof setTimeout>|undefined,poll:ReturnType<typeof setInterval>|undefined;
    try {
      const result=await new Promise((resolve,reject)=>{
        this.pending={id,resolve,reject};
        timer=setTimeout(()=>this.stop("PEER_TIMEOUT"),this.config.timeoutMs);
        poll=setInterval(()=>{try{if(cancelled())this.stop("PEER_CANCELLED");}catch{this.stop("PEER_CANCELLED");}},10);
        this.child.stdin.write(wire,e=>{if(e)this.stop("PEER_CLOSED");});
      });
      if(this.closed)fail(this.fault!);
      return result;
    }finally{clearTimeout(timer);clearInterval(poll);}
  }
  private async discover(cancelled?:()=>boolean):Promise<Record<string,unknown>[]> {
    const result=await this.request("tools/list",{},cancelled);
    if(!record(result)||Object.keys(result).some(k=>k!=="tools")||!Array.isArray(result.tools)||result.tools.length>1024)fail("INVALID_DISCOVERY");
    const seen=new Set<string>();
    for(const t of result.tools) {
      if(!record(t)||typeof t.name!=="string"||!/^[A-Za-z0-9_-]{1,64}$/.test(t.name)||seen.has(t.name)||!record(t.inputSchema)||!record(t.outputSchema))fail("INVALID_DISCOVERY");
      seen.add(t.name);
    }
    return json([...result.tools].sort((a,b)=>a.name<b.name?-1:1));
  }
  /** Only explicit host approvals establish capabilities/read-only admission. */
  registrations(server:string,approvals:Approval[],now:()=>number):ToolRegistration[] {
    const values=json(approvals) as Approval[],seen=new Set<string>();
    if(!Array.isArray(values)||typeof now!=="function")fail("INVALID_CONFIGURATION");
    return values.map(a=>{
      const t=this.catalog.find(t=>t.name===a.name);
      if(!t||seen.has(a.name)||canonicalJson(t.inputSchema)!==canonicalJson(a.inputSchema)||canonicalJson(t.outputSchema)!==canonicalJson(a.outputSchema))fail("DISCOVERY_MISMATCH");
      seen.add(a.name);
      return {...a,server,invoke:async(args,options)=>{
        const cancelled=()=>options.cancelled()||now()>=options.deadline;
        try {
          if(bindingDigest(await this.discover(cancelled))!==this.fingerprint)fail("DISCOVERY_CHANGED");
          if(cancelled())fail("PEER_CANCELLED");
          const response=await this.request("tools/call",{name:a.name,arguments:args},cancelled);
          if(!record(response)||Object.keys(response).some(k=>!["content","structuredContent","isError","_meta"].includes(k))||response.isError!==false&&response.isError!==undefined||!record(response.structuredContent)||!Array.isArray(response.content)||response.content.length>1)fail("INVALID_TOOL_RESPONSE");
          for(const block of response.content) {
            if(!record(block)||Object.keys(block).sort().join(",")!=="text,type"||block.type!=="text"||typeof block.text!=="string"||canonicalJson(parseJson(block.text))!==canonicalJson(response.structuredContent))fail("INVALID_TOOL_RESPONSE");
          }
          if(bindingDigest(await this.discover(cancelled))!==this.fingerprint)fail("DISCOVERY_CHANGED");
          return json(response.structuredContent);
        }catch(e){await this.close();throw e;}
      }};
    });
  }
}
