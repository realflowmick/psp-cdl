// SPDX-License-Identifier: Apache-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import {parseJson} from '@psp-cdl/core';
import {signResultManifest,resultSigningInput,verifyResultManifest,validateResultManifest} from '@psp-cdl/test-harness';
import {suite,runResultCase} from '../../../../../scripts/result-fixtures.mjs';
import {validateResult} from '../../../../../scripts/validate-result.mjs';

for(const c of suite.cases)test('signed results: '+c.id,()=>assert.equal(runResultCase(c).code,c.code));
test('JCS bytes and deterministic Ed25519 output agree with independent oracle',()=>{
  const e=suite.envelope;
  assert.equal(Buffer.from(resultSigningInput(e)).toString('hex'),suite.signingInputHex);
  assert.deepEqual(signResultManifest(e.manifest,e.signature.keyId,e.signature.signedAt,Buffer.from(suite.testKey.seedHex,'hex')),e);
  validateResult('signed',e);
  const reordered=Object.fromEntries(Object.entries(e.manifest).reverse());
  assert.deepEqual(signResultManifest(reordered,e.signature.keyId,e.signature.signedAt,Buffer.from(suite.testKey.seedHex,'hex')),e);
});
test('signature-only verification does not read artifacts or modify caller input',()=>{
  const e=structuredClone(suite.envelope),before=JSON.stringify(e);
  const manifest=verifyResultManifest(e,{...suite.policy,publicKey:Buffer.from(suite.policy.publicKey,'base64url')});
  manifest.status='invalid-source-changed';assert.equal(JSON.stringify(e),before);
});
test('strict input parser rejects duplicate names and library rejects invalid Unicode and unsafe numbers',()=>{
  assert.throws(()=>parseJson('{"manifest":{},"manifest":{}}'));
  for(const value of [NaN,Infinity,9007199254740992,'\ud800']) {
    const manifest=structuredClone(suite.envelope.manifest);manifest.artifacts[0].bytes=value;
    assert.throws(()=>validateResultManifest(manifest));
  }
  for(const seed of [new Uint8Array(31),'secret',null])assert.throws(()=>signResultManifest(suite.envelope.manifest,'test',0,seed));
});
