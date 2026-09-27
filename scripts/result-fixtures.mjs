// SPDX-License-Identifier: Apache-2.0
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {signResultManifest,verifyResultManifest,verifyResultArtifacts} from '@psp-cdl/test-harness';
export const suite=JSON.parse(readFileSync(new URL('../conformance/vectors/evaluation/result-manifest-0.1.json',import.meta.url),'utf8'));
export function runResultCase(c) {
  const data=structuredClone({envelope:suite.envelope,policy:suite.policy,files:suite.files});
  if(c.target) {
    let target=data[c.target];for(const part of c.path.slice(0,-1))target=target[part];
    const last=c.path.at(-1);if(c.delete)delete target[last];else target[last]=structuredClone(c.value);
  }
  if(c.matchingKeyId)data.policy.keyId=data.envelope.signature.keyId;
  if(c.rehashArtifact){
    const raw=Buffer.from(data.files[c.rehashArtifact],'utf8'),f=data.envelope.manifest.artifacts.find(f=>f.path===c.rehashArtifact);
    f.bytes=raw.length;f.sha256=createHash('sha256').update(raw).digest('hex');
  }
  if(c.resign)data.envelope=signResultManifest(data.envelope.manifest,data.envelope.signature.keyId,data.envelope.signature.signedAt,Buffer.from(suite.testKey.seedHex,'hex'));
  data.policy.publicKey=Buffer.from(data.policy.publicKey,'base64url');
  try {
    const manifest=verifyResultManifest(data.envelope,data.policy);
    verifyResultArtifacts(manifest,name=>{if(!Object.hasOwn(data.files,name))throw Error('missing');return Buffer.from(data.files[name],'utf8');});
    return {code:'OK',manifest};
  } catch(error) {return {code:error.code??'UNEXPECTED_ERROR'};}
}
