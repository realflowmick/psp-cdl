// SPDX-License-Identifier: Apache-2.0
import {readFileSync,writeFileSync} from 'node:fs';
import {parseJson,canonicalJson,record} from '@psp-cdl/core';
import {runTrial} from './study-adapter.mjs';
import {validatePilotObservation} from '@psp-cdl/test-harness';
try {
  const bytes=readFileSync(0);if(bytes.length>131072)throw Error();
  const payload=parseJson(new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes));
  if(!record(payload)||Object.keys(payload).sort().join(',')!=='config,input')throw Error();
  const observation=validatePilotObservation(await runTrial(payload.config,payload.input));
  writeFileSync(payload.config.observationFile,canonicalJson({trialId:payload.config.trialId,observation})+'\n',{encoding:'utf8',flag:'wx'});
}catch{console.log('{"error":"ADAPTER_ERROR"}');process.exitCode=1;}
