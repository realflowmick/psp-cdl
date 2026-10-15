// SPDX-License-Identifier: Apache-2.0
import { canonicalJson, record } from "@psp-cdl/core";

/** Development/telemetry hook. Emission never throws, never awaits and never changes an outcome. */
export const OBSERVE_PROFILE="PSP-OBSERVE-0.1";
export type ObserveLevel="digest"|"inspect";
export type ObserveSource="llmproxy"|"mcpproxy";
export interface ObserveScope {sessionId?:string;requestId?:string;step?:number;round?:number}
export interface ObserveEvent {profile:typeof OBSERVE_PROFILE;source:ObserveSource;type:string;scope:ObserveScope;data:Record<string,unknown>}
export type Observer=(event:ObserveEvent)=>unknown;
export interface ObserveOptions {observer:Observer;level?:ObserveLevel}
export type Emit=(type:string,scope:ObserveScope,data:Record<string,unknown>,payload?:()=>Record<string,unknown>)=>void;
const encoder=new TextEncoder();
/** UTF-8 length of the canonical JSON encoding: a size signal, never a digest. */
export function byteLength(value:unknown):number {return encoder.encode(canonicalJson(value)).length;}
export function textBytes(value:string):number {return encoder.encode(value).length;}
/** Keeps only well-typed scope fields; host bindings are never copied wholesale. */
export function scopeOf(fields:Record<string,unknown>):ObserveScope {
  const scope:ObserveScope={};
  if(typeof fields.sessionId==="string")scope.sessionId=fields.sessionId;
  if(typeof fields.requestId==="string")scope.requestId=fields.requestId;
  if(Number.isSafeInteger(fields.step))scope.step=fields.step as number;
  if(Number.isSafeInteger(fields.round))scope.round=fields.round as number;
  return scope;
}
const noop:Emit=()=>{};
/** Validates the option shape with the same strictness as other configuration, then isolates the observer. */
export function makeEmitter(source:ObserveSource,options:ObserveOptions|undefined,fail:(code:string)=>never):Emit {
  if(options===undefined)return noop;
  if(!record(options)||Object.keys(options).some(k=>k!=="observer"&&k!=="level")||typeof options.observer!=="function"||
    options.level!==undefined&&options.level!=="digest"&&options.level!=="inspect")fail("INVALID_CONFIGURATION");
  const observer=options.observer as Observer,inspect=options.level==="inspect";
  return (type,scope,data,payload)=>{
    try {
      const event:ObserveEvent={profile:OBSERVE_PROFILE,source,type,scope:{...scope},data:inspect&&payload?{...data,payload:payload()}:{...data}};
      const result=observer(structuredClone(event));
      const pending=result as {then?:unknown}|null|undefined;
      if(pending&&typeof pending.then==="function")(pending as Promise<unknown>).then(undefined,()=>{});
    }catch{}
  };
}
