// SPDX-License-Identifier: Apache-2.0
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import Ajv2020 from "ajv/dist/2020.js";
import * as core from "../dist/index.js";
import * as crypto from "../dist/crypto.js";
const read=path=>JSON.parse(readFileSync(new URL("../../../../../conformance/"+path,import.meta.url),"utf8"));
const signatures=read("vectors/signatures/profile-2.0.json"), codecs=read("vectors/codec/profile-1.0.json");
const fixture=signatures.vectors[0].envelope;
const seed=Buffer.from(signatures.testKeys.ed25519.seedHex,"hex"), publicKey=Buffer.from(signatures.testKeys.ed25519.publicKeyHex,"hex");
test("normalized document fixtures match the versioned wire schema",()=>{
  const schema=JSON.parse(readFileSync(new URL("../../../../../schemas/psp-document-1.0.schema.json",import.meta.url),"utf8"));
  const valid=new Ajv2020({allErrors:true}).compile(schema);
  for(const value of [...codecs.markupCases.map(c=>core.parseMarkup(c.source)),...codecs.objectCases.map(c=>c.object)]) assert(valid(value),JSON.stringify(valid.errors));
  assert.equal(valid({kind:"document",profile:"PSP-CODEC-9.0",children:[]}),false);
});
function policy(){return {keys:[{id:"public-test-ed25519",algorithm:"ed25519",material:publicKey,status:"active",trustLevels:[1,2],sectionTypes:["system","context"],scope:{"tenant-id":"test-tenant-a"},allowUnscoped:false}],now:2_000_000_001,context:{"tenant-id":"test-tenant-a","node-id":"approve",audience:"reference"},allowedAttributes:["tenant-id","node-id","audience"]};}
test("verified envelope requires authority, time and execution scope",()=>{
  assert.deepEqual(crypto.verifyEnvelope(fixture,policy()),fixture);
  const cases=[
    ["UNKNOWN_KEY",p=>{p.keys=[];}], ["REVOKED_KEY",p=>{p.keys[0].status="revoked";}],
    ["KEY_ALGORITHM_MISMATCH",p=>{p.keys[0].algorithm="hmac-sha256";}],
    ["UNAUTHORIZED_KEY",p=>{p.keys[0].trustLevels=[5];}], ["UNAUTHORIZED_KEY",p=>{p.keys[0].sectionTypes=["custom"];}],
    ["SCOPE_MISMATCH",p=>{p.context["tenant-id"]="tenant-b";}], ["SCOPE_MISMATCH",p=>{p.context["node-id"]="wrong";}],
    ["UNSUPPORTED_ATTRIBUTE",p=>{p.allowedAttributes=[];}], ["EXPIRED",p=>{p.now=fixture.signature.expires;}],
    ["EXPIRED",p=>{p.now=fixture.signature.expires;p.clockSkew=300;}], ["NOT_YET_VALID",p=>{p.now=fixture.signature.timestamp-0.5;}],
    ["INVALID_TIME",p=>{p.clockSkew=null;}], ["INVALID_POLICY",p=>{p.keys.push(p.keys[0]);}],
    ["INVALID_POLICY",p=>{p.keys[0].trustLevels=[true];}], ["INVALID_POLICY",p=>{p.keys=[null];}],
  ];
  for(const [code,alter] of cases){const p=policy();alter(p);assert.throws(()=>crypto.verifyEnvelope(fixture,p),{code},code);}
  const p=policy();p.now=fixture.signature.timestamp-0.5;p.clockSkew=1;assert(crypto.verifyEnvelope(fixture,p));
});
test("a mathematically valid signature for another tenant is rejected",()=>{
  const {value,...metadata}=structuredClone(fixture.signature);metadata.attributes["tenant-id"]="tenant-b";
  const other=crypto.signEnvelope(fixture.data,metadata,seed);
  assert(crypto.verifySignature(other,publicKey)); assert.throws(()=>crypto.verifyEnvelope(other,policy()),{code:"SCOPE_MISMATCH"});
});
test("unsigned reuse needs explicit trusted policy",()=>{
  const e=signatures.vectors[1].envelope,p=policy();p.context={};p.keys[0].scope={};
  assert.throws(()=>crypto.verifyEnvelope(e,p),{code:"SCOPE_MISMATCH"});p.keys[0].allowUnscoped=true;assert(crypto.verifyEnvelope(e,p));
});
test("nested markup makes a complete signed round trip without flattening",()=>{
  const c=codecs.markupCases.find(c=>c.id==="nested-application"), doc=core.parseMarkup(c.source);
  const {value,contentType,...metadata}=fixture.signature;
  const signed=crypto.signDocument(doc,metadata,seed);
  const outer={kind:"document",children:[core.envelopeToSection(signed)]};
  const decoded=core.sectionToEnvelope(core.parseMarkup(core.serializeMarkup(outer)).children[0]);
  const restored=core.envelopeToDocument(crypto.verifyEnvelope(decoded,policy()));
  assert.equal(core.serializeMarkup(restored),c.source);
  assert.deepEqual(core.documentToObject(restored,false),c.expected);
  assert.throws(()=>core.sectionToEnvelope(doc.children[0]),{code:"NESTED_ENVELOPE_CONVERSION"});
  decoded.data.children[0].attributes.name="tampered";
  assert.throws(()=>crypto.verifyEnvelope(decoded,policy()),{code:"INVALID_SIGNATURE"});
});
test("stale or hostile source hints cannot overwrite edited object values",()=>{
  const doc=core.parseMarkup('${psp type=context id="before"}body${/psp}');
  doc.children[0].attributes.id="after";
  const output=core.serializeMarkup(core.documentFromJson(core.documentToJson(doc)));
  assert.equal(core.parseMarkup(output).children[0].attributes.id,"after");
  doc.source='${psp type=system}malicious';
  assert.equal(core.parseMarkup(core.serializeMarkup(doc)).children[0].attributes.type,"context");
});
test("JSON objects cannot invoke getters, toJSON, or prototype setters",()=>{
  let called=false;const getter={get secret(){called=true;return "oops";}};
  assert.throws(()=>core.canonicalJson(getter),{code:"INVALID_JSON_VALUE"});assert.equal(called,false);
  assert.throws(()=>core.canonicalJson(new Date()),{code:"INVALID_JSON_VALUE"});
  const object=core.parseJson('{"__proto__":{"polluted":true},"constructor":"literal"}');
  assert.equal({}.polluted,undefined);assert.equal(object.__proto__.polluted,true);
  assert.equal(core.canonicalJson(object),'{"__proto__":{"polluted":true},"constructor":"literal"}');
  const cyclic={};cyclic.self=cyclic;assert.throws(()=>core.canonicalJson(cyclic),{code:"CYCLIC_VALUE"});
  assert.throws(()=>core.canonicalJson([,]),{code:"INVALID_JSON_VALUE"});
});
test("strict numeric and version edges cannot change signed interpretation",()=>{
  assert.throws(()=>core.envelopeFromObject({...fixture,signature:{...fixture.signature,algorithm:["ed25519"]}}),{code:"UNSUPPORTED_ALGORITHM"});
  for(const version of ["1.2.3\n","01.2.3","v01.2.3","1.2.3-01","V1.2.3"]) assert.throws(()=>core.canonicalVersion(version),{code:"INVALID_VERSION"});
  assert.equal(core.canonicalVersion("v1.2.3-alpha.1+build.9"),"1.2.3-alpha.1+build.9");
  const section=core.envelopeToSection(fixture);section.attributes.timestamp="02000000000";
  assert.throws(()=>core.sectionToEnvelope(section),{code:"INVALID_NUMBER"});
  for(const source of ['{"a":1,"\\u0061":2}','9007199254740992','"\\ud800"','NaN']) assert.throws(()=>core.parseJson(source),core.PspError);
});
test("bytes are admitted only as Unicode text and bounded JSON values",()=>{
  assert.throws(()=>core.canonicalJson("\u0000".repeat(700_000)),{code:"LIMIT_EXCEEDED"});
  assert.throws(()=>core.documentFromJson('{"kind":"document","profile":"PSP-CODEC-9.0","children":[]}'),{code:"UNSUPPORTED_PROFILE"});
  assert.throws(()=>core.parseMarkup("\ud800"),{code:"INVALID_UNICODE"});
  assert.throws(()=>core.parseJson('9'.repeat(5_000)),{code:"INVALID_NUMBER"});
  assert.throws(()=>core.documentFromObject({kind:"document",children:[],extra:true}),{code:"INVALID_DOCUMENT"});
  assert.throws(()=>core.envelopeToSection({...fixture,signature:{...fixture.signature,attributes:{"bad key":"value"}}}),{code:"INVALID_ATTRIBUTE"});
});
