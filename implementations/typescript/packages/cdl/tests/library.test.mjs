// SPDX-License-Identifier: Apache-2.0
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as cdl from "../dist/index.js";
const read=path=>JSON.parse(readFileSync(new URL("../../../../../conformance/"+path,import.meta.url),"utf8"));
test("packaged normative policy table equals its reviewed source",()=>{
  assert.deepEqual(cdl.policyTable(),read("policy/cdl-1.0.json"));
  const copy=cdl.policyTable();copy.rules.length=0;assert(cdl.policyTable().rules.length>0);
});
test("declarations round trip through string, array, objects and JSON",()=>{
  const original={description:"preserved",type:"object","x-cdl-classes":"PHI pii PHI","x-cdl-covenants":[" NO-TRAINING ",""],"x-cdl-capabilities":"processes-in-memory-only"};
  const expected=cdl.parseDeclarations(original);
  for(const format of ["string","array"]){
    const out=cdl.withDeclarations(original,expected,format);
    assert.equal(out.description,"preserved");assert.equal(out.type,"object");
    assert.deepEqual(cdl.parseDeclarations(cdl.parseCdlJson(cdl.serializeCdlJson(out))),expected);
  }
  assert.equal(original["x-cdl-classes"],"PHI pii PHI");
});
test("schema traversal includes homogeneous items and exact grant paths",()=>{
  const schema=read("vectors/codec/profile-1.0.json").cdlSchemas[0].schema;
  assert.deepEqual(cdl.resolveSchemaPolicy(schema,"/items/0/name").classes,["confidential","pii"]);
  assert.throws(()=>cdl.resolveSchemaPolicy(schema,"/summary"),{code:"UNAUTHORIZED_NEGATION"});
  const grants=[{sourceId:"schema#",term:"no-persist",atPath:"/properties/summary"}];
  assert.deepEqual(cdl.resolveSchemaPolicy(schema,"/summary",grants).covenants,["no-training"]);
  assert.deepEqual(cdl.resolveSchemaPolicy(schema,"/unlisted").covenants,["no-persist","no-training"]);
  for(const keyword of ["$ref","allOf","oneOf","prefixItems","dependentSchemas"]) assert.throws(()=>cdl.resolveSchemaPolicy({[keyword]:[]},""),{code:"UNSUPPORTED_SCHEMA"});
  assert.throws(()=>cdl.resolveSchemaPolicy(schema,"/bad~2pointer"),{code:"INVALID_CONTEXT"});
});
test("resolved evaluation never turns a child basis into a parent waiver",()=>{
  const path=[{id:"root",path:"",covenants:"lawful-basis-consent"},{id:"child",path:"/properties/a",covenants:"lawful-basis-contract"}];
  const state=cdl.inheritPolicy(path);
  assert.deepEqual(state.basisGroups,[{origin:"child",terms:["lawful-basis-contract"]},{origin:"root",terms:["lawful-basis-consent"]}]);
  const facts={capabilities:["verifies-contract-active"],checks:{"lawful-basis-contract":"satisfied"},parameters:{},context:{}};
  assert.deepEqual(cdl.evaluateResolvedPolicy(state,{root:facts,child:facts},facts),{decision:"deny",reasonCodes:["LEGAL_BASIS_UNSATISFIED"]});
  assert.deepEqual(cdl.evaluateResolvedPolicy(state,{child:facts},facts),{decision:"deny",reasonCodes:["MISSING_CONTEXT"]});
  const replacement=cdl.inheritPolicy([path[0],{...path[1],covenants:"!lawful-basis-consent lawful-basis-contract"}],[{sourceId:"root",term:"lawful-basis-consent",atPath:path[1].path}]);
  assert.deepEqual(cdl.evaluateResolvedPolicy(replacement,{child:facts},facts),{decision:"allow",reasonCodes:[]});
});
test("per-origin role parameters remain conjunctive",()=>{
  const state=cdl.inheritPolicy([{id:"root",path:"",covenants:"role-restricted-display"},{id:"child",path:"/properties/a",covenants:"role-restricted-display"}]);
  const facts={capabilities:["checks-operator-role"],checks:{"role-restricted-display":"satisfied"},parameters:{allowedRoles:["nurse"]},context:{roles:["nurse"]}};
  const rootFacts={...facts,parameters:{allowedRoles:["physician"]}};
  assert.deepEqual(cdl.evaluateResolvedPolicy(state,{root:rootFacts,child:facts},facts),{decision:"deny",reasonCodes:["ROLE_MISMATCH"]});
});
test("bounds and context types fail closed",()=>{
  assert.throws(()=>cdl.normalizeDeclaration("classes",Array(1025).fill("phi")),{code:"LIMIT_EXCEEDED"});
  const input={classes:[],covenants:["role-restricted-display"],capabilities:["checks-operator-role"],checks:{"role-restricted-display":"satisfied"},parameters:{allowedRoles:["physician"]},context:{roles:"physician"}};
  assert.deepEqual(cdl.evaluatePolicy(input),{decision:"deny",reasonCodes:["INVALID_CONTEXT"]});
  assert.deepEqual(cdl.evaluateBatch([]),{decision:"deny",reasonCodes:["INVALID_DECLARATION"]});
});
