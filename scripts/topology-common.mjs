// SPDX-License-Identifier: Apache-2.0
import {readFileSync,existsSync,openSync,writeSync,closeSync} from 'node:fs';
export const suite=JSON.parse(readFileSync(new URL('../conformance/vectors/topologies/matrix-0.2.json',import.meta.url),'utf8'));
export const records=JSON.parse(readFileSync(new URL('../conformance/vectors/evaluation/servers-0.1.json',import.meta.url),'utf8'));
export const credential='synthetic-fixture-credential';
export const environment=()=>({... (process.env.SystemRoot?{SystemRoot:process.env.SystemRoot}:{}),PSP_FIXTURE_CREDENTIAL:credential});
export const resource=(covenants,capabilities=[])=>({classes:[],covenants,capabilities,checks:{},parameters:{},context:{}});
export const approval=(name,capabilities=[])=>({name,revision:'1',readOnly:name!=='export',complete:true,
  sources:[{id:'host-fixture-registry',capabilities}],inputSchema:records.inputSchema,outputSchema:records.outputSchema});
export const closeApproval=()=>({...approval('fixture_close'),readOnly:false,inputSchema:{type:'object',properties:{},additionalProperties:false},
  outputSchema:{type:'object',properties:{closed:{type:'boolean'}},required:['closed'],additionalProperties:false}});
export function caseById(id) {
  const c=suite.cases.find(c=>c.id===id);
  if(!c)throw Error('UNKNOWN_CASE');
  return c;
}
export function eventLog(path,correlation) {
  const fd=openSync(path,'wx');let sequence=0;
  return {write(kind,recordId=null,code=null){
    if(sequence>=128)throw Error('EVENT_LIMIT');
    writeSync(fd,JSON.stringify({sequence:++sequence,correlation,kind,recordId,code})+'\n');
  },close(){closeSync(fd);}};
}
export function readEvents(path,correlation,complete=false) {
  const text=existsSync(path)?readFileSync(path,'utf8'):'';
  if(complete&&(!text||!text.endsWith('\n')))throw Error('INCOMPLETE_EVENT_LOG');
  const events=text.split('\n').slice(0,-1).map(JSON.parse);
  if(events.some((e,i)=>e.sequence!==i+1||e.correlation!==correlation))throw Error('INVALID_EVENT_LOG');
  return events.map(({kind,recordId,code})=>({kind,recordId,code}));
}
