// SPDX-License-Identifier: Apache-2.0
/** Public synthetic audit inputs. Never use this fixture seed for host trust. */
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {canonicalJson} from '@psp-cdl/core';
import {pilotDigest,signResultManifest,auditResultManifest} from '@psp-cdl/test-harness';
export const suite=JSON.parse(readFileSync(new URL('../conformance/vectors/evaluation/result-audit-0.1.json',import.meta.url),'utf8'));
const key=JSON.parse(readFileSync(new URL('../conformance/vectors/evaluation/result-manifest-0.1.json',import.meta.url),'utf8')).testKey;
export function auditInput(c) {
  const files=Object.fromEntries(Object.entries({...suite.files,...c.patches}).filter(([,v])=>v!==null).map(([k,v])=>[k,Buffer.from(v)]));
  const bundle=JSON.parse(files['bundle.json']),bindings={bundleSha256:pilotDigest(bundle),planSha256:bundle.planSha256,corpusSha256:bundle.corpusSha256,
    mode:bundle.mode,status:c.runStatus??'finalized',recovered:c.recovered??false};
  const descriptors=()=>Object.keys(files).sort().map(path=>({path,bytes:files[path].length,sha256:createHash('sha256').update(files[path]).digest('hex')}));
  const source={schemaVersion:1,scope:'heldout-execution-result-0.1',...bindings,signed:false,fullStudy:false,independentReview:false,
    files:descriptors().map(({path,sha256})=>({path,sha256})),...c.sourceSummary};
  files['manifest.json']=Buffer.from(canonicalJson(source));
  const manifest={schemaVersion:1,scope:'signed-result-manifest-0.1',...bindings,evidencePolicy:'local-synthetic-raw-0.1',fullStudy:false,
    independentReview:false,executionAuthorized:false,artifacts:descriptors()};
  const envelope=signResultManifest(manifest,'public-audit-fixture',0,Buffer.from(key.seedHex,'hex'));
  const policy={keyId:'public-audit-fixture',publicKey:Buffer.from(key.publicKey,'base64url'),status:'active',bundleSha256:bindings.bundleSha256,now:1,...c.policy};
  if(c.tamper)files[c.tamper]=Buffer.concat([files[c.tamper],Buffer.from('\n')]);
  if(c.missing)delete files[c.missing];
  return {envelope,policy,files};
}
export function runAuditCase(c) {
  const {envelope,policy,files}=auditInput(c);
  try{return {code:'OK',report:auditResultManifest(envelope,policy,name=>{if(!Object.hasOwn(files,name))throw Error();return files[name];})};}
  catch(error){return {code:error.code??'UNEXPECTED_ERROR'};}
}
