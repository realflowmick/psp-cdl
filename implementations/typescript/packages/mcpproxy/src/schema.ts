// SPDX-License-Identifier: Apache-2.0
import { canonicalJson, record } from "@psp-cdl/core";

/** Deliberately finite JSON Schema subset. Unknown keywords are never ignored. */
export function checkSchema(schema:unknown, depth=0):void {
  if(!record(schema)||depth>16||typeof schema.type!=="string") throw new Error("UNSUPPORTED_SCHEMA");
  const fields:Record<string,string[]>={object:["properties","required","additionalProperties"],array:["items","minItems","maxItems"],string:["minLength","maxLength"],number:["minimum","maximum"],integer:["minimum","maximum"],boolean:[],null:[]};
  const type=schema.type;
  if(!Object.hasOwn(fields,type)||Object.keys(schema).some(k=>!["type","enum",...fields[type]!].includes(k))) throw new Error("UNSUPPORTED_SCHEMA");
  if("enum" in schema&&(!Array.isArray(schema.enum)||!schema.enum.length||schema.enum.length>1024)) throw new Error("UNSUPPORTED_SCHEMA");
  if(schema.type==="object") {
    if(!record(schema.properties)||schema.additionalProperties!==false||!Array.isArray(schema.required)||schema.required.some(k=>typeof k!=="string"||!Object.hasOwn(schema.properties as object,k))||new Set(schema.required).size!==schema.required.length) throw new Error("UNSUPPORTED_SCHEMA");
    for(const s of Object.values(schema.properties)) checkSchema(s,depth+1);
  }
  if(schema.type==="array") checkSchema(schema.items,depth+1);
  for(const [low,high] of [["minItems","maxItems"],["minLength","maxLength"],["minimum","maximum"]]) {
    for(const k of [low!,high!]) if(k in schema&&(typeof schema[k]!=="number"||!Number.isFinite(schema[k])||(k!=="minimum"&&k!=="maximum"&&(!Number.isSafeInteger(schema[k])||(schema[k] as number)<0)))) throw new Error("UNSUPPORTED_SCHEMA");
    if(low! in schema&&high! in schema&&(schema[low!] as number)>(schema[high!] as number)) throw new Error("UNSUPPORTED_SCHEMA");
  }
}

export function matches(schema:any,value:unknown):boolean {
  if(schema.enum&&!schema.enum.some((v:unknown)=>canonicalJson(v)===canonicalJson(value))) return false;
  const range=(n:number,lo:string,hi:string)=>(schema[lo]===undefined||n>=schema[lo])&&(schema[hi]===undefined||n<=schema[hi]);
  switch(schema.type) {
    case "object":return record(value)&&schema.required.every((k:string)=>Object.hasOwn(value,k))&&Object.keys(value).every(k=>Object.hasOwn(schema.properties,k)&&matches(schema.properties[k],value[k]));
    case "array":return Array.isArray(value)&&range(value.length,"minItems","maxItems")&&value.every(v=>matches(schema.items,v));
    case "string":return typeof value==="string"&&range([...value].length,"minLength","maxLength");
    case "number":case "integer":return typeof value==="number"&&Number.isFinite(value)&&(schema.type!=="integer"||Number.isInteger(value))&&range(value,"minimum","maximum");
    case "boolean":return typeof value==="boolean";
    case "null":return value===null;
    default:return false;
  }
}
