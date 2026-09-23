// SPDX-License-Identifier: Apache-2.0
import {McpServer,type McpToolService} from "@psp-cdl/mcp-server";
import {ServiceError,type Principal} from "@psp-cdl/api-server";
import {McpDispatchGate,DispatchError,type CallOptions} from "./dispatch.js";

/** One launcher-authenticated caller/session per connection; no generic forwarding. */
export function createMcpProxy(gate:McpDispatchGate,credential:()=>string,sessionId:string,controls:()=>CallOptions):McpServer {
  async function protect<T>(work:()=>Promise<T>):Promise<T> {
    try{return await work();}catch(e){if(e instanceof DispatchError)throw new ServiceError(e.code,e.code==="INVALID_REQUEST"||e.code==="INVALID_ARGUMENTS"?400:403);throw e;}
  }
  const service:McpToolService={
    authenticate:t=>gate.authenticate(t),
    discover:(token,p)=>protect(()=>gate.listTools(token,sessionId,controls(),p)),
    callTool:(name,args,token,p:Principal)=>protect(async()=>{
      const result=await gate.callTool(token,sessionId,{name,arguments:args},controls(),p);
      return {data:result.data as Record<string,unknown>,meta:{"psp-cdl/provenance":result.provenance}};
    })
  };
  return new McpServer(service,credential);
}
