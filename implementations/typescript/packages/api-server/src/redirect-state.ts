// SPDX-License-Identifier: Apache-2.0
import {record} from "@psp-cdl/core";
import {identifier} from "./service.js";

export const REDIRECT_PROFILE="PSP-LLM-REDIRECT-0.1";
/** Deliberately bounded profile grammar; never resolve this URI over the network. */
export function validRedirectTarget(value:unknown):value is string {
  return typeof value==="string"&&value.length<=256&&
    /^mcp:\/\/[a-z0-9]+(?:[.-][a-z0-9]+)*\/applications\/[A-Za-z0-9][A-Za-z0-9_-]*$/.test(value)&&!/[\r\n]/.test(value);
}
export function validRedirect(value:unknown):value is Record<string,unknown> {
  return record(value)&&Object.keys(value).sort().join(",")==="expiresAt,nodeId,nodeVersion,policyVersion,target"&&
    validRedirectTarget(value.target)&&[value.nodeId,value.nodeVersion,value.policyVersion].every(identifier)&&
    typeof value.expiresAt==="number"&&Number.isSafeInteger(value.expiresAt)&&value.expiresAt>0;
}
