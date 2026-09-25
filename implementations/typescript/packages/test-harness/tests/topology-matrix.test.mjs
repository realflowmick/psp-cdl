// SPDX-License-Identifier: Apache-2.0
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {validate} from '../../../../../scripts/validate-topology-matrix.mjs';
const root=new URL('../../../../../',import.meta.url);
const json=path=>JSON.parse(readFileSync(new URL(path,root),'utf8'));
const suite=json('conformance/vectors/topologies/matrix-0.1.json');

test('workflow seed mappings preserve exact inputs and do not adopt draft expectations',()=>{
  validate('suite',suite);
  assert.equal(new Set(suite.cases.map(c=>c.id)).size,suite.cases.length);
  assert.deepEqual(suite.cases.filter(c=>c.seed).map(c=>c.seed).sort(),['CDL-001','CDL-002','PSP-001','PSP-002','PSP-003']);
  for(const c of suite.cases.filter(c=>c.seed)) {
    const seed=json('conformance/vectors/'+c.seed+'.json');
    assert.equal(seed.status,'draft');
    for(const [key,value] of Object.entries(seed.input))assert.deepEqual(c.input[key],value,c.id+': '+key);
  }
  assert.equal(suite.cases.find(c=>c.seed==='CDL-002').kind,'blocked');
});

test('schema rejects malformed and boolean-as-count adapter observations',()=>{
  const entry={id:suite.cases[0].id,observation:structuredClone(suite.cases[0].expected)};
  validate('adapter',[entry]);
  entry.observation.providerCalls=true;
  assert.throws(()=>validate('adapter',[entry]));
  delete entry.observation.providerCalls;
  assert.throws(()=>validate('adapter',[entry]));
  assert.throws(()=>validate('adapter',[{id:entry.id,error:'PRIVATE_EXCEPTION_TEXT'}]));
});

test('generic result schema rejects unavailable results disguised as observed passes',()=>{
  const cell={topology:'C',peerImplementation:'python',variant:'mediated',seed:null,enforcementPoints:[],
    result:{caseId:'missing-chain',implementation:'typescript',commit:'0'.repeat(40),profile:suite.profile,status:'unsupported',evidence:['No adapter.']},observation:null};
  validate('cell',cell);
  cell.result.status='passed';
  assert.throws(()=>validate('cell',cell));
  cell.result.status='unsupported';cell.observation=suite.cases[0].expected;
  assert.throws(()=>validate('cell',cell));
});
