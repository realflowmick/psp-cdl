// SPDX-License-Identifier: Apache-2.0
import { PspError, canonicalJson, parseJson, record, validateJson } from "@psp-cdl/core";
import { tableData, enforcementData } from "./tables.js";

type Kind = "classes" | "covenants" | "capabilities";
interface Rule { id:string; kind:"class"|"covenant"; term:string; conflictAny?:string[]; conflictUnless?:{any:string[];unlessAny:string[]}; requireAll?:string[]; requireAny?:string[]; check?:string; checkWhenAny?:string[]; parameter?:"roles"|"jurisdictions"; group?:string; forbidProcessing?:boolean }
interface Table { classes:string[]; capabilities:string[]; rules:Rule[]; implications:Record<string,string[]>; reasonStages:string[][] }
const table = tableData as unknown as Table;
const registry: Record<Kind, Set<string>> = {classes:new Set(table.classes), covenants:new Set(table.rules.filter(r => r.kind === "covenant").map(r=>r.term)), capabilities:new Set(table.capabilities)};
export const CDL_PROFILE = "CDL-DETERMINISTIC-1.0";
export interface Decision { decision:"allow"|"deny"|"unsupported"; reasonCodes:string[] }
export interface Declarations { classes:string[]; covenants:string[]; capabilities:string[] }
export interface PolicyNode { id:string; path:string; classes?:unknown; covenants?:unknown }
export interface NegationGrant { sourceId:string; term:string; atPath:string }
export interface PolicyState { classes:string[]; covenants:string[]; origins:Record<string,string[]>; basisGroups:{origin:string;terms:string[]}[] }
export interface PolicyInput { classes:unknown; covenants:unknown; capabilities:unknown; checks:Record<string,"satisfied"|"failed"|"unknown">; parameters:{allowedRoles?:string[];allowedJurisdictions?:string[]}; context:{roles?:string[];processingJurisdictions?:string[]} }
const fail = (code:string):never => { throw new PspError(code); };
const sorted = (values:Iterable<string>) => [...new Set(values)].sort();
const kinds:Kind[] = ["classes", "covenants", "capabilities"];
const result = (codes:string[]):Decision => ({decision:codes.length ? codes.some(c => ["UNSUPPORTED_TERM", "UNSUPPORTED_SCHEMA"].includes(c)) ? "unsupported" : "deny" : "allow", reasonCodes:codes});
function ordered(codes:Iterable<string>):Decision {
  const set = new Set(codes);
  for (const stage of table.reasonStages) { const found=stage.filter(c=>set.has(c)); if(found.length) return result(found); }
  return set.size ? result(["INVALID_CONTEXT"]) : result([]);
}
/** Lexical terms only, in first-occurrence order. No kind, vocabulary or policy authority is inferred. */
export function tokenizeDeclaration(value:unknown):string[] {return lexicalTokens(value);}
function lexicalTokens(value:unknown,kind?:Kind):string[] {
  if (value === undefined) return [];
  let raw:string[];
  if (typeof value === "string") {
    if (new TextEncoder().encode(value).length > 65_536) return fail("LIMIT_EXCEEDED");
    raw = value.split(/[\t\n\v\f\r ]+/).filter(Boolean);
  } else if (Array.isArray(value) && value.every(v => typeof v === "string")) {
    raw = value as string[];
    if (new TextEncoder().encode(raw.join("")).length > 65_536) return fail("LIMIT_EXCEEDED");
  } else return fail("INVALID_DECLARATION");
  if (raw.length > 1_024) return fail("LIMIT_EXCEEDED");
  const out = new Set<string>();
  for (let token of raw) {
    token = token.replace(/^[\t\n\v\f\r ]+|[\t\n\v\f\r ]+$/g, "").replace(/[A-Z]/g, c=>c.toLowerCase());
    if (!token) continue;
    if (token.length > 128) return fail("LIMIT_EXCEEDED");
    if (!/^!?[a-z0-9]+(?:-[a-z0-9]+)*$/.test(token) || /[^!a-z0-9-]/.test(token) || kind!==undefined&&kind!=="covenants"&&token.startsWith("!")) return fail("INVALID_DECLARATION");
    out.add(token);
  }
  return [...out];
}
function tokens(kind:Kind, value:unknown):string[] {
  if (!kinds.includes(kind)) return fail("INVALID_DECLARATION");
  const terms=lexicalTokens(value,kind);
  if(terms.some(t=>t.startsWith("!")&&terms.includes(t.slice(1))))return fail("CONTRADICTORY_DECLARATION");
  return sorted(terms);
}
function supported(kind:Kind, values:string[]):void { if (values.some(t=>!registry[kind].has(t.replace(/^!/,"")))) fail("UNSUPPORTED_TERM"); }
export function normalizeDeclaration(kind:Kind, value:unknown):string[] { const t=tokens(kind,value); supported(kind,t); return t; }
export function serializeDeclaration(kind:Kind, value:unknown, format:"string"|"array"="string"):string|string[] {
  if (!["string","array"].includes(format)) return fail("INVALID_OPTION");
  const t=normalizeDeclaration(kind,value); return format === "array" ? t : t.join(" ");
}
export function parseDeclarations(value:unknown):Declarations {
  if(!record(value)) return fail("INVALID_DECLARATION");
  const data=validateJson(value) as Record<string,unknown>;
  const out = Object.fromEntries(kinds.map(k=>[k,tokens(k,data["x-cdl-"+k])])) as unknown as Declarations;
  for(const k of kinds) supported(k,out[k]); return out;
}
/** Return a detached schema/object with canonical declarations; preserve all other fields. */
export function withDeclarations(value:unknown, declarations:Declarations, format:"string"|"array"="array"):Record<string,unknown> {
  const out=validateJson(value); if(!record(out)) return fail("INVALID_DECLARATION");
  for(const kind of kinds) out["x-cdl-"+kind]=serializeDeclaration(kind,declarations[kind],format);
  return out;
}
export function parseCdlJson(source:string):Record<string,unknown> { const v=parseJson(source); if(!record(v)) return fail("INVALID_DECLARATION"); return v; }
export function serializeCdlJson(value:unknown):string { if(!record(value)) return fail("INVALID_DECLARATION"); return canonicalJson(value); }
/** Grants are supplied by the host's authority store, never by model/tool output. */
export function inheritPolicy(path:readonly PolicyNode[], grants:readonly NegationGrant[] = []):PolicyState {
  validateJson({path,grants});
  if (!Array.isArray(path) || !Array.isArray(grants)) return fail("INVALID_DECLARATION");
  if(path.length>64) return fail("LIMIT_EXCEEDED");
  const seen=new Set<string>();
  const parsed=path.map(n=>{
    if(!record(n)||typeof n.id!=="string"||!n.id||typeof n.path!=="string"||!validPointer(n.path)||seen.has(n.id)) return fail("INVALID_CONTEXT");
    seen.add(n.id); return {id:n.id,path:n.path,classes:tokens("classes",n.classes),covenants:tokens("covenants",n.covenants)};
  });
  for(const n of parsed) { supported("classes",n.classes); supported("covenants",n.covenants); }
  for(const g of grants) if(!record(g)||typeof g.sourceId!=="string"||typeof g.term!=="string"||typeof g.atPath!=="string"||!validPointer(g.atPath)) return fail("INVALID_CONTEXT");
  const classes=new Set<string>(), origins=new Map<string,Set<string>>();
  for(const node of parsed) {
    for(const c of node.classes) classes.add(c);
    for(const t of node.covenants.filter(t=>t.startsWith("!"))) {
      const term=t.slice(1), sources=origins.get(term);
      if(!sources?.size) return fail("INVALID_NEGATION");
      if([...sources].some(id=>!grants.some(g=>g.sourceId===id && g.term===term && g.atPath===node.path))) return fail("UNAUTHORIZED_NEGATION");
      origins.delete(term);
    }
    for(const t of node.covenants.filter(t=>!t.startsWith("!"))) { if(!origins.has(t)) origins.set(t,new Set()); origins.get(t)!.add(node.id); }
  }
  const bases=new Map<string,string[]>();
  for(const [term,ids] of origins) if(table.rules.some(r=>r.term===term && r.group==="article6")) for(const id of ids) { if(!bases.has(id)) bases.set(id,[]); bases.get(id)!.push(term); }
  return {classes:sorted(classes),covenants:sorted(origins.keys()),origins:Object.fromEntries([...origins].sort(([a],[b])=>a<b?-1:a>b?1:0).map(([t,s])=>[t,sorted(s)])),basisGroups:[...bases].sort(([a],[b])=>a<b?-1:a>b?1:0).map(([origin,terms])=>({origin,terms:sorted(terms)}))};
}
export function aggregateCapabilities(sources:readonly {id:string;capabilities:unknown}[], complete:boolean):string[] {
  validateJson({sources,complete});
  if(!Array.isArray(sources)||typeof complete!=="boolean") return fail("INVALID_DECLARATION");
  if(sources.length>1_024) return fail("LIMIT_EXCEEDED");
  const values=sources.map(s=>{if(!record(s)||typeof s.id!=="string") return fail("INVALID_DECLARATION"); return tokens("capabilities",s.capabilities);});
  for(const t of values) supported("capabilities",t);
  if(!complete) return fail("INCOMPLETE_CAPABILITIES");
  const caps=new Set(values.flat());
  for(const cap of caps) for(const implied of table.implications[cap] ?? []) caps.add(implied);
  return sorted(caps);
}
/** Pure PDP. checks/parameters/context must be built by authenticated host adapters. */
export function evaluatePolicy(input:PolicyInput):Decision {
  try { return evaluate(input); }
  catch(error) { if(error instanceof PspError) return ordered([table.reasonStages.flat().includes(error.code)?error.code:"INVALID_DECLARATION"]); throw error; }
}
function evaluate(input:PolicyInput):Decision {
  const v=validateJson(input); if(!record(v)) return fail("INVALID_DECLARATION");
  const classes=tokens("classes",v.classes), covenants=tokens("covenants",v.covenants), capabilities=tokens("capabilities",v.capabilities);
  supported("classes",classes); supported("covenants",covenants); supported("capabilities",capabilities);
  if(!record(v.checks)||!record(v.parameters)||!record(v.context)||Object.values(v.checks).some(s=>typeof s!=="string"||!["satisfied","failed","unknown"].includes(s))) return fail("INVALID_CONTEXT");
  const checks=v.checks, params=v.parameters, context=v.context;
  for(const [o,allowed] of [[params,["allowedRoles","allowedJurisdictions"]],[context,["roles","processingJurisdictions"]]] as const) {
    if(Object.keys(o).some(k=>!allowed.includes(k as never))) return fail("INVALID_CONTEXT");
    for(const list of Object.values(o)) if(!Array.isArray(list)||list.some(i=>typeof i!=="string"||!i)) return fail("INVALID_CONTEXT");
  }
  if(covenants.some(t=>t.startsWith("!"))) return fail("INVALID_NEGATION");
  const caps=new Set(aggregateCapabilities([{id:"bound-invocation",capabilities}],true));
  const roles=context.roles as string[]|undefined, places=context.processingJurisdictions as string[]|undefined;
  const allowedRoles=params.allowedRoles as string[]|undefined, allowedPlaces=params.allowedJurisdictions as string[]|undefined;
  if(places && ([...caps].some(c=>c.startsWith("processes-in-jurisdiction-")&&!places.includes(c.slice(26))) || places.some(p=>!["eu","us"].includes(p)))) return fail("INVALID_CONTEXT");
  const active=table.rules.filter(r=>(r.kind==="class"?classes:covenants).includes(r.term));
  const errors=new Set<string>(), any=(list:string[])=>list.some(c=>caps.has(c));
  const met=(r:Rule)=>(!r.requireAll||r.requireAll.every(c=>caps.has(c)))&&(!r.requireAny||any(r.requireAny));
  for(const r of active) {
    if(r.forbidProcessing) errors.add("PROCESSING_PROHIBITED");
    if(any(r.conflictAny??[])||(r.conflictUnless&&any(r.conflictUnless.any)&&!any(r.conflictUnless.unlessAny))) errors.add("CAPABILITY_CONFLICT");
  }
  if(errors.size) return ordered(errors);
  for(const r of active.filter(r=>!r.group)) {
    if(r.parameter==="roles") {
      if(!allowedRoles?.length||!roles) { errors.add("MISSING_CONTEXT"); continue; }
      if(!roles.some(role=>allowedRoles.includes(role))) { errors.add("ROLE_MISMATCH"); continue; }
    }
    if(r.parameter==="jurisdictions") {
      if(!allowedPlaces?.length||!places?.length) { errors.add("MISSING_CONTEXT"); continue; }
      if(places.some(p=>!allowedPlaces.includes(p))) { errors.add("JURISDICTION_MISMATCH"); continue; }
      if(places.some(p=>!caps.has("processes-in-jurisdiction-"+p))) { errors.add("REQUIREMENT_UNSATISFIED"); continue; }
    }
    if(!met(r)) { errors.add("REQUIREMENT_UNSATISFIED"); continue; }
    if(r.check&&(!r.checkWhenAny||any(r.checkWhenAny))&&checks[r.check]!=="satisfied") errors.add("CHECK_UNSATISFIED");
  }
  const bases=active.filter(r=>r.group==="article6");
  if(bases.length&&!bases.some(r=>met(r)&&checks[r.check!] === "satisfied")) errors.add("LEGAL_BASIS_UNSATISFIED");
  return ordered(errors);
}
export function evaluateBatch(resources:readonly PolicyInput[]):Decision {
  if(!Array.isArray(resources)||!resources.length) return result(["INVALID_DECLARATION"]);
  if(resources.length>1_024) return result(["LIMIT_EXCEEDED"]);
  return ordered(resources.flatMap(v=>evaluatePolicy(v).reasonCodes));
}
export type PolicyFacts=Omit<PolicyInput,"classes"|"covenants">;
/** Preserve each inherited origin's group and parameters; never evaluate a flattened union. */
export function evaluateResolvedPolicy(state:PolicyState, factsByOrigin:Record<string,PolicyFacts>, classFacts:PolicyFacts):Decision {
  try {
    validateJson({state,factsByOrigin,classFacts});
    if(!record(state)||!Array.isArray(state.classes)||!Array.isArray(state.covenants)||!record(state.origins)||!record(factsByOrigin)||!record(classFacts)||state.classes.some(t=>typeof t!=="string")||state.covenants.some(t=>typeof t!=="string")||Object.values(factsByOrigin).some(f=>!record(f))) return result(["INVALID_CONTEXT"]);
    const grouped=new Map<string,string[]>();
    if(Object.keys(state.origins).some(t=>!state.covenants.includes(t))) return result(["INVALID_CONTEXT"]);
    for(const term of state.covenants) {
      const origins=state.origins[term];
      if(!Array.isArray(origins)||!origins.length||origins.some(o=>typeof o!=="string"||!o)) return result(["INVALID_CONTEXT"]);
      for(const id of origins) { if(!grouped.has(id)) grouped.set(id,[]); grouped.get(id)!.push(term); }
    }
    const decisions=[evaluatePolicy({...classFacts,classes:state.classes,covenants:[]})];
    for(const [origin,covenants] of grouped) {
      if(!Object.hasOwn(factsByOrigin,origin)) decisions.push(result(["MISSING_CONTEXT"]));
      else decisions.push(evaluatePolicy({...factsByOrigin[origin]!,classes:[],covenants}));
    }
    return ordered(decisions.flatMap(d=>d.reasonCodes));
  } catch(e) { if(e instanceof PspError) return ordered([e.code]); throw e; }
}
export function checkEnforcement(topology:string, minimumTopology:string, gates:readonly string[]):Decision {
  const order:readonly string[]=enforcementData.topologyOrder;
  if(!order.includes(topology)||!order.includes(minimumTopology)||!Array.isArray(gates)||gates.some(g=>typeof g!=="string"||!(enforcementData.requiredGates.C as readonly string[]).includes(g))) return result(["INVALID_CONTEXT"]);
  if(order.indexOf(topology)<Math.max(1,order.indexOf(minimumTopology))) return result(["TOPOLOGY_INSUFFICIENT"]);
  const required:readonly string[]=enforcementData.requiredGates[topology as "A"|"B"|"C"];
  return result(required.some(g=>!gates.includes(g))?["MEDIATION_INCOMPLETE"]:[]);
}
export function validPointer(value:string):boolean { return value==="" || (value.startsWith("/")&&!/~(?![01])/.test(value)); }
/** Resolve the profile's properties/homogeneous-items subset; do not ignore applicators. */
export function resolveSchemaPolicy(input:unknown, dataPointer:string, grants:readonly NegationGrant[]=[], sourceId="schema"):PolicyState {
  const schema=validateJson(input);
  if(typeof sourceId!=="string"||!sourceId||typeof dataPointer!=="string"||!validPointer(dataPointer)) return fail("INVALID_CONTEXT");
  const segments=dataPointer===""?[]:dataPointer.slice(1).split("/").map(s=>s.replace(/~1/g,"/").replace(/~0/g,"~"));
  const path:PolicyNode[]=[];
  const unsupported=["$ref","$dynamicRef","allOf","anyOf","oneOf","not","if","then","else","dependentSchemas","prefixItems","contains","patternProperties","unevaluatedProperties","unevaluatedItems","additionalItems","dependencies","propertyNames","contentSchema"];
  let current:unknown=schema, pointer="";
  for(let i=0;i<=segments.length;i++) {
    if(current===true) current={};
    if(!record(current)) return fail("UNSUPPORTED_SCHEMA");
    const schemaNode=current;
    if(unsupported.some(k=>Object.hasOwn(schemaNode,k))||Array.isArray(current.items)||record(current.additionalProperties)) return fail("UNSUPPORTED_SCHEMA");
    const node:PolicyNode={id:sourceId+"#"+pointer,path:pointer};
    if(Object.hasOwn(current,"x-cdl-classes")) node.classes=current["x-cdl-classes"];
    if(Object.hasOwn(current,"x-cdl-covenants")) node.covenants=current["x-cdl-covenants"];
    path.push(node);
    if(i===segments.length) break;
    const part=segments[i]!;
    if(current.type==="array"||Object.hasOwn(current,"items")) {
      if(!/^(0|[1-9][0-9]*)$/.test(part)) return fail("INVALID_CONTEXT");
      current=current.items??{}; pointer+="/items";
    } else {
      if(current.properties!==undefined&&!record(current.properties)) return fail("UNSUPPORTED_SCHEMA");
      const props=current.properties as Record<string,unknown>|undefined;
      if(props&&Object.hasOwn(props,part)) current=props[part];
      else { if(current.additionalProperties===false) return fail("INVALID_CONTEXT"); current={}; }
      pointer+="/properties/"+part.replace(/~/g,"~0").replace(/\//g,"~1");
    }
  }
  return inheritPolicy(path,grants);
}
/** Portable model/proxy adapters can inspect a detached copy; they cannot alter the engine table. */
export function policyTable():unknown { return validateJson(tableData); }
