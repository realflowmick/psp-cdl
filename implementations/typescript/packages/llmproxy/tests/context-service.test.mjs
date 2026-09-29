// SPDX-License-Identifier: Apache-2.0
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import {suite,runCase} from '../../../../../scripts/context-service-fixtures.mjs';
for(const c of suite.cases)test('context/service: '+c.id,async()=>{
  const actual=await runCase(c);
  for(const [k,v] of Object.entries(c.expected))assert.deepEqual(actual[k],v,JSON.stringify(actual));
});
test('shared proposal schema accepts supported forms and rejects authority injection',()=>{
  const schema=JSON.parse(readFileSync(new URL('../../../../../schemas/context-service.schema.json',import.meta.url),'utf8'));
  const valid=new Ajv2020({strict:true}).compile(schema);
  for(const c of suite.cases)for(const p of c.proposals)if(typeof p!=='string') {
    assert.equal(valid(p),!['INVALID_RESPONSE','UNSUPPORTED_SERVICE'].includes(c.expected.code),c.id);
  }
  assert.equal(valid({type:'service',operation:'getNode',arguments:{nodeId:'entry\n',nodeVersion:'1'}}),false);
});
