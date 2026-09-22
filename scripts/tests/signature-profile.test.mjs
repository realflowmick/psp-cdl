// SPDX-License-Identifier: Apache-2.0
// Fixture oracle only: not a PSP parser, trust registry, or production verifier.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash, createHmac, createPrivateKey, createPublicKey, sign, verify, timingSafeEqual } from "node:crypto";
import canonicalize from "canonicalize";
import Ajv2020 from "ajv/dist/2020.js";

const fixtures = JSON.parse(readFileSync(new URL("../../conformance/vectors/signatures/profile-2.0.json", import.meta.url), "utf8"));
const schema = JSON.parse(readFileSync(new URL("../../schemas/psp-signature-envelope-2.0.schema.json", import.meta.url), "utf8"));
const validate = new Ajv2020({allErrors:true}).compile(schema);
const vectors = new Map(fixtures.vectors.map(v => [v.id,v]));
const privateKey = createPrivateKey({key:Buffer.concat([Buffer.from("302e020100300506032b657004220420","hex"),Buffer.from(fixtures.testKeys.ed25519.seedHex,"hex")]),format:"der",type:"pkcs8"});
const publicKey = createPublicKey({key:Buffer.concat([Buffer.from("302a300506032b6570032100","hex"),Buffer.from(fixtures.testKeys.ed25519.publicKeyHex,"hex")]),format:"der",type:"spki"});
const hmacKey = Buffer.from(fixtures.testKeys.hmac.keyHex,"hex");

function fields(envelope) {
  return envelope.signature ? [envelope.signature,envelope.data] : [envelope["x-signature"],envelope["x-data"]];
}
function canonicalContent(envelope) {
  const [s,original] = fields(envelope);
  const metadata = Object.fromEntries(Object.entries(s).filter(([k]) => !["value","timestamp","version"].includes(k)));
  metadata.trustLevel ??= 2;
  metadata.priority ??= 50;
  metadata.attributes ??= {};
  const data = s.contentType === "text" ? original.replace(/\r\n?/g,"\n").replace(/^[\t\n ]+|[\t\n ]+$/g,"") : original;
  return canonicalize({data,metadata});
}
function input(envelope) {
  const [s] = fields(envelope);
  return Buffer.from(canonicalContent(envelope)+"|"+String(s.timestamp)+"|"+s.version.replace(/^v/,""),"utf8");
}
function decode(encoded, algorithm) {
  assert.match(encoded,/^[A-Za-z0-9_-]+$/);
  const bytes=Buffer.from(encoded,"base64url");
  assert.equal(bytes.toString("base64url"),encoded);
  assert.equal(bytes.length,algorithm==="ed25519"?64:32);
  return bytes;
}
function cryptoValid(vector, message) {
  const s=vector.envelope.signature;
  const signature=decode(s.value,s.algorithm);
  return s.algorithm==="ed25519" ? verify(null,message,publicKey,signature) : timingSafeEqual(createHmac("sha256",hmacKey).update(message).digest(),signature);
}
function timeDecision({timestamp,expires,now,skew}) {
  if (![timestamp,expires,skew].every(Number.isSafeInteger) || timestamp<0 || expires<=timestamp || skew<0 || skew>300 || !Number.isFinite(now)) return "invalid";
  if (now>=expires) return "expired";
  if (now<timestamp-skew) return "not_yet_valid";
  return "valid";
}
for (const vector of fixtures.vectors) {
  test(vector.id+": independent JCS, exact bytes and deterministic crypto", () => {
    assert(validate(vector.envelope),JSON.stringify(validate.errors));
    const message=input(vector.envelope);
    assert.equal(canonicalContent(vector.envelope),vector.canonicalContent);
    assert.equal(message.toString("hex"),vector.inputUtf8Hex);
    assert.equal(createHash("sha256").update(message).digest("hex"),vector.inputSha256);
    assert(cryptoValid(vector,message));
    const s=vector.envelope.signature;
    const generated=s.algorithm==="ed25519"?sign(null,message,privateKey):createHmac("sha256",hmacKey).update(message).digest();
    assert.equal(generated.toString("base64url"),s.value);
  });
}
for (const mutation of fixtures.mutations) {
  test("protected mutation: "+mutation.id, () => {
    const vector=vectors.get(mutation.vector);
    const altered=structuredClone(vector.envelope);
    let parent=altered;
    for (const name of mutation.path.slice(0,-1)) parent=parent[name];
    parent[mutation.path.at(-1)]=mutation.value;
    // Use the original algorithm/key so this tests signed-byte binding, not dispatch policy.
    assert(!cryptoValid(vector,input(altered)));
  });
}
for (const equivalent of fixtures.equivalents) {
  test("equivalent representation: "+equivalent.id, () => {
    assert(validate(equivalent.envelope),JSON.stringify(validate.errors));
    const vector=vectors.get(equivalent.vector);
    assert.equal(input(equivalent.envelope).toString("hex"),vector.inputUtf8Hex);
    assert(cryptoValid(vector,input(equivalent.envelope)));
  });
}
for (const c of fixtures.expirationCases) test("time boundary: "+c.id,()=>assert.equal(timeDecision(c),c.expected));
for (const c of fixtures.schemaCases) test("envelope structure: "+c.id,()=>assert.equal(validate(c.envelope),c.valid,JSON.stringify(validate.errors)));
for (const c of fixtures.invalidEncodings) test("reject encoding: "+c.id,()=>assert.throws(()=>decode(c.value,"ed25519")));
test("ASCII trimming does not remove Unicode boundary whitespace",()=>{
  const envelope=structuredClone(fixtures.vectors[0].envelope);
  envelope.data="\u00a0text\u00a0";
  assert.equal(JSON.parse(canonicalContent(envelope)).data,envelope.data);
});
test("JCS rejects a lone surrogate",()=>assert.throws(()=>canonicalize({text:"\ud800"})));

test("stripping explicit trust does not silently authorize its default",()=>{
  const vector=vectors.get("SIG2-TEXT");
  const envelope=structuredClone(vector.envelope);
  delete envelope.signature.trustLevel;
  assert(!cryptoValid(vector,input(envelope)));
});
test("stripping expiration is rejected before signature verification",()=>{
  const envelope=structuredClone(fixtures.vectors[0].envelope);
  delete envelope.signature.expires;
  assert.equal(validate(envelope),false);
});
