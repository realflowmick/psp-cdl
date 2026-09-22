// SPDX-License-Identifier: Apache-2.0
/** Executes proposed-standard fixtures against public library APIs, with no provider/tool calls. */
import * as core from "@psp-cdl/core";
import * as crypto from "@psp-cdl/core/crypto";
import * as cdl from "@psp-cdl/cdl";

export interface ProfileCaseResult { caseId:string; status:"passed"|"failed"|"error"; actual:unknown }
// Fixture contents deliberately include invalid values. Runtime libraries validate them.
type Fixture = {id:string;operation:string;input:any;expected:unknown};
const ok = (extra:Record<string,unknown>={}) => ({decision:"allow",reasonCodes:[],...extra});
export function executePolicyCase(c:Fixture):unknown {
  const i=c.input;
  try {
    switch(c.operation) {
      case "normalize": return ok({tokens:cdl.normalizeDeclaration(i.kind,i.declaration)});
      case "inherit": { const state=cdl.inheritPolicy(i.path,i.grants); return ok({classes:state.classes,covenants:state.covenants}); }
      case "aggregate": return ok({capabilities:cdl.aggregateCapabilities(i.sources,i.complete)});
      case "evaluate": return cdl.evaluatePolicy(i);
      case "evaluate-batch": return cdl.evaluateBatch(i.resources);
      case "enforcement": return cdl.checkEnforcement(i.topology,i.minimumTopology,i.gates);
      case "trust": return ok({trustLevel:i.signed?core.authorizeTrustLevel(i.claimedLevel??2,i.allowedLevels):core.sourceTrustLevel(i.source)});
      case "engine-isolation": return core.requireEngineIsolation();
      default: throw new core.PspError("UNSUPPORTED_OPERATION");
    }
  } catch(error) {
    if(!(error instanceof core.PspError)) throw error;
    return {decision:["UNSUPPORTED_TERM","UNSUPPORTED_SCHEMA","ENGINE_ISOLATION_UNSUPPORTED","UNSUPPORTED_OPERATION"].includes(error.code)?"unsupported":"deny",reasonCodes:[error.code]};
  }
}
function check(caseId:string, expected:unknown, operation:()=>unknown):ProfileCaseResult {
  try { const actual=operation(); return {caseId,status:core.canonicalJson(actual)===core.canonicalJson(expected)?"passed":"failed",actual}; }
  catch(error) { return {caseId,status:"error",actual:{error:error instanceof core.PspError?error.code:"INTERNAL_ERROR"}}; }
}
function errorCode(operation:()=>unknown):string { try { operation(); return "NO_ERROR"; } catch(e) { if(e instanceof core.PspError) return e.code; throw e; } }
function fixtureGroups(suite:any, fields:string[]):void {
  if(fields.some(f=>!Array.isArray(suite[f]))) throw new core.PspError("INVALID_FIXTURE");
  const ids=fields.flatMap(f=>suite[f].map((c:any)=>c?.id));
  if(!ids.length||ids.some(id=>typeof id!=="string"||!id)||new Set(ids).size!==ids.length) throw new core.PspError("INVALID_FIXTURE");
}
export function runPolicyVectors(suite:any):ProfileCaseResult[] {
  if(suite?.profile!==cdl.CDL_PROFILE||!Array.isArray(suite.cases)) throw new core.PspError("UNSUPPORTED_PROFILE");
  fixtureGroups(suite,["cases"]);
  return suite.cases.map((c:Fixture)=>check(c.id,c.expected,()=>executePolicyCase(c)));
}
export function runCodecVectors(suite:any):ProfileCaseResult[] {
  if(suite?.profile!==core.CODEC_PROFILE) throw new core.PspError("UNSUPPORTED_PROFILE");
  fixtureGroups(suite,["markupCases","objectCases","invalidMarkupCases","invalidJsonCases","cdlSchemas"]);
  const results:ProfileCaseResult[]=[];
  for(const c of suite.markupCases) {
    results.push(check(c.id+":parse",c.expected,()=>core.documentToObject(core.parseMarkup(c.source),false)));
    results.push(check(c.id+":source-roundtrip",c.source,()=>core.serializeMarkup(core.documentFromJson(core.documentToJson(core.parseMarkup(c.source))))));
    results.push(check(c.id+":canonical-roundtrip",c.expected,()=>core.documentToObject(core.parseMarkup(core.serializeMarkup(core.documentFromObject(c.expected),"canonical")),false)));
  }
  for(const c of suite.objectCases) results.push(check(c.id,c.object,()=>{
    const ast=core.documentFromJson(core.documentToJson(core.documentFromObject(c.object),false));
    return core.documentToObject(core.parseMarkup(core.serializeMarkup(ast,"canonical")),false);
  }));
  for(const c of suite.invalidMarkupCases) results.push(check(c.id,c.error,()=>errorCode(()=>core.parseMarkup(c.source))));
  for(const c of suite.invalidJsonCases) results.push(check(c.id,c.error,()=>errorCode(()=>core.parseJson(c.source))));
  for(const c of suite.cdlSchemas) results.push(check(c.id,c.schema,()=>cdl.parseCdlJson(cdl.serializeCdlJson(c.schema))));
  return results;
}
export function runSignatureVectors(suite:any):ProfileCaseResult[] {
  if(suite?.profile!=="PSP-SIGNATURE-2.0") throw new core.PspError("UNSUPPORTED_PROFILE");
  fixtureGroups(suite,["vectors","mutations","equivalents","expirationCases","invalidEncodings"]);
  const results:ProfileCaseResult[]=[];
  const key=(v:any)=>Buffer.from(v.envelope.signature.algorithm==="ed25519"?suite.testKeys.ed25519.publicKeyHex:suite.testKeys.hmac.keyHex,"hex");
  for(const v of suite.vectors) {
    results.push(check(v.id+":bytes",v.inputUtf8Hex,()=>Buffer.from(core.signatureInput(v.envelope)).toString("hex")));
    results.push(check(v.id+":content",v.canonicalContent,()=>core.protectedContent(v.envelope)));
    results.push(check(v.id+":verify",true,()=>crypto.verifySignature(v.envelope,key(v))));
    results.push(check(v.id+":sign",v.envelope.signature.value,()=>{
      const {value,...metadata}=v.envelope.signature;
      const privateKey=metadata.algorithm==="ed25519"?Buffer.from(suite.testKeys.ed25519.seedHex,"hex"):key(v);
      return crypto.signEnvelope(v.envelope.data,metadata,privateKey).signature.value;
    }));
    results.push(check(v.id+":markup-roundtrip",v.inputUtf8Hex,()=>{
      const doc:core.Document={kind:"document",children:[core.envelopeToSection(v.envelope)]};
      const restored=core.parseMarkup(core.serializeMarkup(doc));
      return Buffer.from(core.signatureInput(core.sectionToEnvelope(restored.children[0] as core.Section))).toString("hex");
    }));
    results.push(check(v.id+":alias-roundtrip",v.inputUtf8Hex,()=>Buffer.from(core.signatureInput(core.parseEnvelope(core.serializeEnvelope(v.envelope,true)))).toString("hex")));
  }
  for(const m of suite.mutations) results.push(check(m.id,false,()=>{
    const v=suite.vectors.find((v:any)=>v.id===m.vector), e=structuredClone(v.envelope);
    let parent=e; for(const k of m.path.slice(0,-1)) parent=parent[k]; parent[m.path.at(-1)]=m.value;
    try { return crypto.verifySignature(e,key(v)); } catch(error) { if(error instanceof core.PspError) return false; throw error; }
  }));
  for(const v of suite.equivalents) results.push(check(v.id,true,()=>crypto.verifySignature(v.envelope,key(suite.vectors.find((f:any)=>f.id===v.vector)))));
  for(const v of suite.expirationCases) results.push(check(v.id,v.expected,()=>core.validateTime(v.timestamp,v.expires,v.now,v.skew)));
  for(const v of suite.invalidEncodings) results.push(check(v.id,"INVALID_ENCODING",()=>errorCode(()=>core.decodeSignature(v.value,"ed25519"))));
  return results;
}
export function profileReport(policy:any,codec:any,signatures:any) {
  const results=[...runPolicyVectors(policy),...runCodecVectors(codec),...runSignatureVectors(signatures)];
  const passed=results.filter(r=>r.status==="passed").length;
  return {mode:"profile-conformance",profiles:["CDL-DETERMINISTIC-1.0","PSP-TRUST-1.0","PSP-CODEC-1.0","PSP-SIGNATURE-2.0"],status:passed===results.length?"passed":"failed",executed:results.length,passed,failed:results.length-passed,results};
}
