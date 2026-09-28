// SPDX-License-Identifier: Apache-2.0
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import {selectTransition} from '../dist/index.js';

const cases=JSON.parse(readFileSync(new URL('../../../../../conformance/vectors/transitions/profile-0.1.json',import.meta.url),'utf8')).cases;
test('accepted transition requests and selections satisfy the shared schema',()=>{
  const schema=JSON.parse(readFileSync(new URL('../../../../../schemas/transitions-0.1.schema.json',import.meta.url),'utf8'));
  const ajv=new Ajv2020({allErrors:true});
  const valid=ajv.compile(schema),selection=ajv.compile({$ref:schema.$id+'#/$defs/selection'});
  for(const c of cases.filter(c=>c.expected.result)) {
    assert(valid(c.request),JSON.stringify(valid.errors));
    assert(selection(selectTransition(c.request)),JSON.stringify(selection.errors));
  }
});
for(const c of cases) test('transition: '+c.id,()=>{
  if(c.expected.error) assert.throws(()=>selectTransition(c.request),e=>e.code===c.expected.error);
  else assert.deepEqual(selectTransition(c.request),c.expected.result);
});
test('transition objects do not execute accessors',()=>{
  const request=structuredClone(cases[0].request);
  let calls=0;
  Object.defineProperty(request.facts.amount,'value',{get(){calls++;return 1;},enumerable:true});
  assert.throws(()=>selectTransition(request),e=>e.code==='INVALID_JSON_VALUE');
  assert.equal(calls,0);
});
test('selection neither mutates nor returns authority-bearing input',()=>{
  const request=structuredClone(cases[0].request),before=structuredClone(request);
  const result=selectTransition(request);
  result.usedFacts.push('changed');
  assert.deepEqual(request,before);
  assert.deepEqual(selectTransition(request),cases[0].expected.result);
});
