// SPDX-License-Identifier: Apache-2.0
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {validate} from '../../../../../scripts/validate-topology-matrix.mjs';
import {runDirect} from '../../../../../scripts/topology-adapter.mjs';
const root=new URL('../../../../../',import.meta.url);
const json=path=>JSON.parse(readFileSync(new URL(path,root),'utf8'));
const suite=json('conformance/vectors/topologies/matrix-0.2.json');

test('direct provider callback rejects malformed responses before dispatch and bounds loops',async()=>{
  let calls=0;
  const registrations=[{server:'reference',name:'allowed',inputSchema:{},outputSchema:{},invoke:async()=>{calls++;return {message:'public'};}}];
  const options={cancelled:()=>false,maxSteps:2};
  for(const response of [null,{},[],{type:'final',text:1},{type:'tool',name:'reference.allowed'},{type:'tool',name:'reference.allowed',arguments:[]}])
    await assert.rejects(runDirect({invoke:async()=>response},registrations,'synthetic',options),{code:'INVALID_RESPONSE'});
  assert.equal(calls,0);
  await assert.rejects(runDirect({invoke:async()=>({type:'tool',name:'reference.allowed',arguments:{}})},registrations,'synthetic',options),{code:'STEP_LIMIT'});
  assert.equal(calls,2);
});

test('all five seed mappings preserve exact inputs with applicable A/B/C expectations',()=>{
  validate('suite',suite);
  validate('mappings',json('conformance/workflow-mappings-0.2.json'));
  assert.equal(new Set(suite.cases.map(c=>c.id)).size,suite.cases.length);
  assert.deepEqual(suite.cases.filter(c=>c.seed).map(c=>c.seed).sort(),['CDL-001','CDL-002','PSP-001','PSP-002','PSP-003']);
  for(const c of suite.cases.filter(c=>c.seed)) {
    const seed=json('conformance/vectors/'+c.seed+'.json');
    assert.equal(seed.status,'draft');
    for(const [key,value] of Object.entries(seed.input))assert.deepEqual(c.input[key],value,c.id+': '+key);
    assert(c.expected.B&&c.expected.C);
  }
  assert.deepEqual(suite.cases.find(c=>c.seed==='CDL-002').expected.B.terms,['pii','no-training']);
});

test('malformed observations and leaked diagnostic data cannot masquerade as results',()=>{
  const entry={id:suite.cases[0].id,observation:structuredClone(suite.cases[0].expected.C)};
  validate('adapter',[entry]);
  entry.observation.providerCalls=true;
  assert.throws(()=>validate('adapter',[entry]));
  delete entry.observation.providerCalls;
  assert.throws(()=>validate('adapter',[entry]));
  assert.throws(()=>validate('adapter',[{id:entry.id,error:'PRIVATE_EXCEPTION_TEXT'}]));
});

test('C requires a proxy identity; unavailable results cannot be reported as observed passes',()=>{
  const cell={cellId:'C/typescript/python/python/example',topology:'C',peerImplementation:'python',proxyImplementation:'python',applicable:true,
    variant:'mediated',seed:null,enforcementPoints:[],result:{caseId:'example',implementation:'typescript',commit:'0'.repeat(40),profile:suite.profile,status:'error',evidence:['No observation.']},observation:null};
  validate('cell',cell);
  cell.result.status='passed';assert.throws(()=>validate('cell',cell));
  cell.observation=suite.cases[0].expected.C;validate('cell',cell);
  cell.proxyImplementation=null;assert.throws(()=>validate('cell',cell));
});
