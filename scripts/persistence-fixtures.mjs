// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import Ajv from 'ajv/dist/2020.js';
import {WorkflowStore} from '../implementations/typescript/packages/api-server/dist/persistence.js';
import {SqliteBackend} from '../implementations/typescript/packages/api-server/dist/sqlite.js';

export const fixture=JSON.parse(readFileSync(new URL('../conformance/vectors/persistence/profile-0.1.json',import.meta.url),'utf8'));
export const secret=new Uint8Array(32).fill(42); // Public synthetic test secret only.
const validateCommand=new Ajv().compile(JSON.parse(readFileSync(new URL('../schemas/persistence/commands-0.1.schema.json',import.meta.url),'utf8')));
export function resolveRefs(value,results) {
  if(Array.isArray(value)) return value.map(v=>resolveRefs(v,results));
  if(value&&typeof value==='object') {
    if(Object.keys(value).length===1&&value.$ref) return value.$ref.split('.').reduce((o,k)=>o[k],results);
    return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,resolveRefs(v,results)]));
  }
  return value;
}
export async function runFixture(path) {
  let now=fixture.now, allowed=true, backend, store;
  const open=()=>{backend=new SqliteBackend(path,fixture.epoch,()=>now);store=new WorkflowStore(backend,{resumeSecret:secret,authorizePersistence:()=>allowed});};
  const results={}, report=[];open();
  try {
    for(const step of fixture.steps) {
      if(step.control==='restart') {backend.close();open();continue;}
      if(step.control==='clock') {now=step.value;continue;}
      allowed=step.allow??true;
      const command=resolveRefs(step.command,results), actor=step.actor??fixture.actor;
      assert.equal(validateCommand(command),step.error!=='INVALID_COMMAND',step.id+': schema');
      if(step.error) await assert.rejects(()=>store.execute(actor,command),{code:step.error},step.id);
      else {
        const actual=await store.execute(actor,command), expected=resolveRefs(step.expect,results);
        if(step.expect.$ref) assert.deepEqual(actual,expected,step.id);
        else for(const [k,v] of Object.entries(expected)) assert.deepEqual(actual[k],v,step.id+':'+k);
        results[step.id]=actual;
      }
      report.push(step.id);
    }
    return report;
  } finally {backend.close();}
}
