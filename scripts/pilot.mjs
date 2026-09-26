// SPDX-License-Identifier: Apache-2.0
import {openSync,readSync,closeSync,writeFileSync,mkdirSync,realpathSync,existsSync} from 'node:fs';
import {resolve,relative,isAbsolute,dirname,extname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseJson,canonicalJson} from '@psp-cdl/core';
import {createPilotPlan,analyzePilot,pilotDigest,PilotError} from '@psp-cdl/test-harness';
const root=realpathSync(fileURLToPath(new URL('..',import.meta.url)));
function read(path) {
  const fd=openSync(path,'r'),bytes=Buffer.alloc(4194305);let size=0;
  try {while(size<bytes.length){const n=readSync(fd,bytes,size,bytes.length-size,null);if(!n)break;size+=n;}}
  finally {closeSync(fd);}
  if(size>4194304)throw Error('Input limit exceeded');
  return parseJson(new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes.subarray(0,size)));
}
try {
  const [command,...tokens]=process.argv.slice(2),args=new Map();
  const keys=command==='plan'?['--request','--output']:command==='analyze'?['--plan','--outcomes','--output']:[];
  if(tokens.length!==keys.length*2||!keys.length)throw Error('Invalid arguments');
  for(let i=0;i<tokens.length;i+=2){if(!keys.includes(tokens[i])||args.has(tokens[i]))throw Error('Invalid arguments');args.set(tokens[i],tokens[i+1]);}
  const output=resolve(args.get('--output')),artifactRoot=resolve(root,'.artifacts');
  if(existsSync(artifactRoot)&&realpathSync(artifactRoot)!==artifactRoot)throw Error('Invalid artifact root');
  // Resolve the nearest existing parent, including any symlink, before creating directories.
  let parent=dirname(output);const suffix=[];
  while(!existsSync(parent)){suffix.unshift(relative(dirname(parent),parent));parent=dirname(parent);}
  const resolvedOutput=resolve(realpathSync(parent),...suffix,relative(dirname(output),output));
  const location=relative(artifactRoot,resolvedOutput);
  if(!location||location.startsWith('..')||isAbsolute(location)||extname(output)!=='.json')throw Error('Invalid output path');
  const result=command==='plan'?createPilotPlan(read(args.get('--request'))):analyzePilot(read(args.get('--plan')),read(args.get('--outcomes')));
  const content=canonicalJson(result)+'\n';
  mkdirSync(dirname(output),{recursive:true});writeFileSync(output,content,{encoding:'utf8',flag:'wx'});
  console.log(JSON.stringify({output:relative(root,output).split('\\').join('/'),sha256:pilotDigest(result),scope:result.scope,executionAuthorized:false,fullStudy:false}));
}catch(error){console.log(JSON.stringify({status:'rejected',code:error instanceof PilotError?error.code:'INVALID_INPUT_OR_OUTPUT',executionAuthorized:false}));process.exitCode=2;}
