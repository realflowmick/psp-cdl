// SPDX-License-Identifier: Apache-2.0
import {canonicalVersion,parseMarkup,sectionToEnvelope,type Envelope} from "@psp-cdl/core";
import {identifier,type Principal} from "@psp-cdl/api-server";
import {bounded} from "@psp-cdl/api-server/persistence";
import type {PinnedMcpClient} from "@psp-cdl/mcpproxy/mcp";
import {refreshToolDefinition} from "./mcp-refresh-contract.js";
export const MCP_PROMPT_REFRESH_PROFILE="PSP-MCP-PROMPT-REFRESH-0.1";
export class PromptRefreshError extends Error {
  constructor(public readonly code:string){super(code);this.name="PromptRefreshError";}
}
const fail=(code:string):never=>{throw new PromptRefreshError(code);};
/** A detached definition for a host's dedicated authenticated refresh service. */
export const mcpRefreshToolDefinition=():typeof refreshToolDefinition=>bounded(refreshToolDefinition) as typeof refreshToolDefinition;

/** Bind once to an approved peer/catalog and exact owner/session, outside the model tool registry. */
export class McpPromptRefresher {
  private readonly invoke:ReturnType<PinnedMcpClient["bindControlTool"]>;
  private readonly tenantId:string;
  private readonly subjectId:string;
  private readonly sessionId:string;
  private readonly cancelled:()=>boolean;
  constructor(private readonly peer:PinnedMcpClient,config:{principal:Principal;sessionId:string;approvedCatalogDigest:string;now:()=>number;cancelled:()=>boolean;toolName?:string;toolRevision?:string}) {
    if(!config||!config.principal||![config.principal.tenantId,config.principal.subjectId,config.sessionId].every(identifier)||typeof config.now!=="function"||typeof config.cancelled!=="function")fail("INVALID_CONFIGURATION");
    this.tenantId=config.principal.tenantId;this.subjectId=config.principal.subjectId;this.sessionId=config.sessionId;this.cancelled=config.cancelled;
    const definition=mcpRefreshToolDefinition();
    this.invoke=peer.bindControlTool({name:config.toolName??definition.name,revision:config.toolRevision??"refresh-1",inputSchema:definition.inputSchema,outputSchema:definition.outputSchema},config.approvedCatalogDigest,config.now);
  }
  async refresh(principal:Principal,binding:Record<string,unknown>,request:Record<string,unknown>):Promise<Envelope> {
    if(!principal||!binding||!request||principal.tenantId!==this.tenantId||principal.subjectId!==this.subjectId||binding.tenantId!==this.tenantId||binding.subjectId!==this.subjectId||binding.sessionId!==this.sessionId||request.session_id!==this.sessionId)fail("REFRESH_BINDING_MISMATCH");
    try{if(typeof request.current_version!=="string"||canonicalVersion(request.current_version)!==request.current_version)fail("INVALID_REFRESH_REQUEST");}catch{fail("INVALID_REFRESH_REQUEST");}
    const result=await this.invoke(request,{deadline:binding.deadline as number,cancelled:this.cancelled}) as {prompt:string};
    try {
      const doc=parseMarkup(result.prompt);
      const section=doc.children[0];
      if(doc.children.length!==1||!section||section.kind!=="section")return fail("INVALID_REFRESH_RESPONSE");
      const envelope=sectionToEnvelope(section);
      if(envelope.signature.sectionType!=="system"||envelope.signature.contentType!=="text")fail("INVALID_REFRESH_RESPONSE");
      // Structural parsing is not verification. RefreshingLlmLoop checks current keys, scope, freshness and host approval.
      return envelope;
    }catch{await this.peer.close();return fail("INVALID_REFRESH_RESPONSE");}
  }
}
