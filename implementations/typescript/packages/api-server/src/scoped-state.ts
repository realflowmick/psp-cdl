// SPDX-License-Identifier: Apache-2.0
import {createHash} from "node:crypto";
import {canonicalJson,record} from "@psp-cdl/core";
import {identifier} from "./service.js";
export const SCOPED_PROFILE="PSP-LLM-SCOPED-0.1";
const exact=(v:unknown,keys:string):v is Record<string,any>=>record(v)&&Object.keys(v).sort().join(",")===keys;
const natural=(v:unknown):v is number=>typeof v==="number"&&Number.isSafeInteger(v)&&v>=0;
export const scopedDigest=(v:unknown):string=>createHash("sha256").update(canonicalJson(v),"utf8").digest("hex");
export const validDigest=(v:unknown):v is string=>typeof v==="string"&&v.length===64&&/^[a-f0-9]{64}$/.test(v);
export const validThreatPolicy=(v:unknown):v is Record<string,string>=>exact(v,"id,version")&&identifier(v.id)&&identifier(v.version);
export const validScope=(v:unknown):v is Record<string,any>=>exact(v,"id,systemDigest,threatPolicy,version")&&identifier(v.id)&&identifier(v.version)&&validDigest(v.systemDigest)&&validThreatPolicy(v.threatPolicy);
export function validScopedCompletion(v:unknown):v is Record<string,any> {
  return exact(v,"completedAt,policy,profile,requestId,retained,scope,threatState,turnCount,violationCount")&&v.profile===SCOPED_PROFILE&&v.policy==="scoped"&&identifier(v.requestId)&&natural(v.completedAt)&&v.completedAt<=253402300799&&validScope(v.scope)&&record(v.threatState)&&record(v.retained)&&natural(v.turnCount)&&natural(v.violationCount)&&v.violationCount<=v.turnCount;
}
export function validScopedOutput(o:unknown):boolean {
  if(!exact(o,"provenance,text")||typeof o.text!=="string"||!exact(o.provenance,"outputDigest,profile,providerId,providerRevision,steps,trustLevel"))return false;
  const p=o.provenance;
  return p.profile==="PSP-LLM-LOOP-0.1"&&p.trustLevel===5&&identifier(p.providerId)&&identifier(p.providerRevision)&&p.steps===1&&p.outputDigest===scopedDigest({text:o.text});
}
