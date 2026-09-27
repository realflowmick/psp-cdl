// SPDX-License-Identifier: Apache-2.0
/** Offline TypeScript verification; no key discovery, provider calls or execution authority. */
import {constants,openSync,closeSync,readSync,fstatSync,lstatSync,readdirSync,realpathSync} from 'node:fs';
import {resolve,dirname,extname,join} from 'node:path';
import {parseArgs} from 'node:util';
import {parseJson} from '@psp-cdl/core';
import {verifyResultManifest,verifyResultArtifacts,ResultManifestError} from '@psp-cdl/test-harness';
import {validateHeldout} from './validate-heldout.mjs';
import {validateResult} from './validate-result.mjs';

function read(path) {
  const before=lstatSync(path);
  if(!before.isFile() || before.isSymbolicLink() || before.nlink!==1) throw Error('Not an ordinary file');
  const fd=openSync(path,constants.O_RDONLY|(constants.O_NOFOLLOW??0));
  try {
    const opened=fstatSync(fd);
    if(opened.dev!==before.dev || opened.ino!==before.ino || opened.size>4194304) throw Error('Invalid file');
    const data=Buffer.alloc(opened.size+1);let offset=0,n;
    while(offset<data.length && (n=readSync(fd,data,offset,data.length-offset,null))>0)offset+=n;
    const after=fstatSync(fd);
    if(offset!==opened.size || opened.size!==after.size || opened.mtimeMs!==after.mtimeMs)throw Error('Unstable file');
    return data.subarray(0,offset);
  } finally {closeSync(fd);}
}
const json=path=>parseJson(new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(read(path)));
try {
  const {values,positionals}=parseArgs({options:{directory:{type:'string'},signed:{type:'string'},trust:{type:'string'}},allowPositionals:true});
  if(positionals.length!==1 || positionals[0]!=='verify' || !values.directory || !values.signed || !values.trust)throw Error('Invalid arguments');
  const envelope=json(values.signed),trust=json(values.trust);
  validateResult('trust',trust);
  const publicKey=Buffer.from(trust.publicKey,'base64url');
  if(publicKey.toString('base64url')!==trust.publicKey)throw new ResultManifestError('INVALID_RESULT_POLICY');
  const manifest=verifyResultManifest(envelope,{keyId:trust.keyId,publicKey,status:trust.status,bundleSha256:trust.bundleSha256,now:Math.floor(Date.now()/1000)});
  const selected=resolve(values.directory);
  if(lstatSync(selected).isSymbolicLink())throw Error('Linked directory');
  const root=realpathSync(selected);
  const inventory=()=>{
    const names=readdirSync(root).filter(p=>['.json','.jsonl'].includes(extname(p))).sort();
    if(JSON.stringify(names)!==JSON.stringify(manifest.artifacts.map(f=>f.path)))throw new ResultManifestError('RESULT_DIRECTORY_MISMATCH');
  };
  const artifact=name=>{
    const path=join(root,name);
    if(dirname(realpathSync(path))!==root)throw Error('Artifact outside selected directory');
    return read(path);
  };
  inventory();verifyResultArtifacts(manifest,artifact);inventory();
  validateHeldout('manifest',parseJson(new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(artifact('manifest.json'))));
  console.log(JSON.stringify({status:'verified',signatureVerified:true,artifactsVerified:true,bundleSha256:manifest.bundleSha256,
    mode:manifest.mode,runStatus:manifest.status,artifacts:manifest.artifacts.length,fullStudy:false,independentReview:false,executionAuthorized:false}));
} catch(error) {
  console.log(JSON.stringify({status:'rejected',code:error.code??'INVALID_RESULT_INPUT_OR_STATE',executionAuthorized:false}));
  process.exitCode=2;
}
