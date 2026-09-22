// SPDX-License-Identifier: Apache-2.0
// Actual wire interchange companion to check-parity.py; public synthetic fixtures only.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as core from "@psp-cdl/core";
import * as crypto from "@psp-cdl/core/crypto";
import * as cdl from "@psp-cdl/cdl";
const fixture=name=>JSON.parse(readFileSync(new URL("../conformance/vectors/"+name,import.meta.url),"utf8"));
const codec=fixture("codec/profile-1.0.json"), signatures=fixture("signatures/profile-2.0.json");
const seed=Buffer.from(signatures.testKeys.ed25519.seedHex,"hex");
const {value,contentType,...metadata}=signatures.vectors[0].envelope.signature;
const inputs=[...codec.markupCases.map(c=>[c.id,core.parseMarkup(c.source)]),...codec.objectCases.map(c=>[c.id,core.documentFromObject(c.object)])];
const publicKey=e=>Buffer.from(e.signature.algorithm==="ed25519"?signatures.testKeys.ed25519.publicKeyHex:signatures.testKeys.hmac.keyHex,"hex");
function emitBundle(){
  return {
    documents:inputs.map(([id,doc])=>({id,markup:core.serializeMarkup(doc),canonical:core.serializeMarkup(doc,"canonical"),json:core.documentToJson(doc),semantic:core.documentToObject(doc,false)})),
    envelopes:[...signatures.vectors.map(v=>[v.id,crypto.signEnvelope(v.envelope.data,(({value,...m})=>m)(v.envelope.signature),v.envelope.signature.algorithm==="ed25519"?seed:publicKey(v.envelope))]),
      ["nested-document",crypto.signDocument(inputs.find(([id])=>id==="nested-application")[1],metadata,seed)]].map(([id,e])=>({id,json:core.serializeEnvelope(e),markup:core.serializeMarkup({kind:"document",children:[core.envelopeToSection(e)]}),inputHex:Buffer.from(core.signatureInput(e)).toString("hex")})),
    schemas:codec.cdlSchemas.map(c=>cdl.serializeCdlJson(c.schema)),
    declarations:["string","array"].map(format=>cdl.withDeclarations({title:"Portable declarations"},{classes:["PII"],covenants:["no-persist","no-training"],capabilities:[]},format))
  };
}
if(process.argv[2]==="--emit") process.stdout.write(JSON.stringify(emitBundle()));
else if(process.argv[2]==="--verify") {
  const peer=JSON.parse(readFileSync(0,"utf8"));
  assert.deepEqual(peer,emitBundle(),"Python serialization differs from TypeScript");
  for(const c of peer.documents){
    const fromJson=core.documentFromJson(c.json);
    assert.equal(core.serializeMarkup(fromJson),c.markup);
    assert.equal(core.serializeMarkup(fromJson,"canonical"),c.canonical);
    assert.deepEqual(core.documentToObject(core.parseMarkup(c.markup),false),c.semantic);
    assert.deepEqual(core.documentToObject(core.parseMarkup(c.canonical),false),c.semantic);
  }
  for(const c of peer.envelopes){
    const e=core.sectionToEnvelope(core.parseMarkup(c.markup).children[0]);
    assert.equal(core.serializeEnvelope(e),c.json);
    assert.equal(Buffer.from(core.signatureInput(e)).toString("hex"),c.inputHex);
    assert(crypto.verifySignature(e,publicKey(e)));
    if(c.id==="nested-document") assert.equal(core.serializeMarkup(core.envelopeToDocument(e)),codec.markupCases.find(c=>c.id==="nested-application").source);
  }
  for(const schema of peer.schemas) assert.equal(cdl.serializeCdlJson(cdl.parseCdlJson(schema)),schema);
  for(const d of peer.declarations) assert.deepEqual(cdl.parseDeclarations(d),{classes:["pii"],covenants:["no-persist","no-training"],capabilities:[]});
  console.log(`${peer.documents.length} documents and ${peer.envelopes.length} signed envelopes decoded from Python.`);
} else throw new Error("Use --emit or --verify");
