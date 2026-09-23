// SPDX-License-Identifier: Apache-2.0
import {canonicalVersion,record} from "@psp-cdl/core";
export const PROMPT_REFRESH_PROFILE="PSP-PROMPT-REFRESH-0.1";
const numeric=(s:string)=>/^[0-9]+$/.test(s);
const compare=(a:string,b:string)=>a===b?0:a<b?-1:1;
const numberCompare=(a:string,b:string)=>a.length===b.length?compare(a,b):a.length<b.length?-1:1;
/** SemVer precedence, without converting arbitrarily long version numbers to floats. */
export function comparePromptVersions(a:string,b:string):number {
  const parts=(s:string)=>{const v=canonicalVersion(s).split('+')[0]!,dash=v.indexOf('-');return {core:(dash<0?v:v.slice(0,dash)).split('.'),pre:dash<0?[]:v.slice(dash+1).split('.')};};
  const x=parts(a),y=parts(b);
  for(let i=0;i<3;i++){const n=numberCompare(x.core[i]!,y.core[i]!);if(n)return n;}
  if(!x.pre.length||!y.pre.length)return x.pre.length===y.pre.length?0:x.pre.length?-1:1;
  for(let i=0;i<Math.min(x.pre.length,y.pre.length);i++){
    const u=x.pre[i]!,v=y.pre[i]!,n=numeric(u)&&numeric(v)?numberCompare(u,v):numeric(u)!==numeric(v)?numeric(u)?-1:1:compare(u,v);if(n)return n;
  }
  return Math.sign(x.pre.length-y.pre.length);
}
export function validPromptState(s:unknown):boolean {
  if(!record(s)||Object.keys(s).sort().join(',')!=="digest,expires,grace,interval,policies,refreshCount,timestamp,turnCount,version")return false;
  try{if(canonicalVersion(s.version as string)!==s.version)return false;}catch{return false;}
  if(typeof s.digest!=="string"||s.digest.length!==64||!/^[a-f0-9]{64}$/.test(s.digest))return false;
  for(const k of ["expires","grace","interval","refreshCount","timestamp","turnCount"])if(typeof s[k]!=="number"||!Number.isSafeInteger(s[k])||(s[k] as number)<0)return false;
  return (s.expires as number)>(s.timestamp as number)&&Array.isArray(s.policies)&&s.policies.length>0&&s.policies.length<=2&&
    s.policies.every((p,i,list)=>["expiration","interval"].includes(p)&&list.indexOf(p)===i)&&
    s.policies.includes("interval")===(s.interval as number>0);
}
