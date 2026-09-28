// SPDX-License-Identifier: Apache-2.0
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as core from '@psp-cdl/core';
import {runCase} from '../../../../../scripts/llm-fixtures.mjs';
const suite=JSON.parse(readFileSync(new URL('../../../../../conformance/vectors/llm/in-context-0.1.json',import.meta.url),'utf8'));
for(const c of suite.cases)test('in-context: '+c.id,async()=>{
  const actual=await runCase(c);
  for(const [k,v] of Object.entries(c.expected))assert.deepEqual(actual[k],v,JSON.stringify(actual));
  for(const request of actual.requests){
    assert.equal(request.messages[0].content,c.settings.promptText);
    for(const secret of ['test-owner','test-signing-key','tenant-a','sessionVersion'])assert(!JSON.stringify(request).includes(secret));
  }
  if(c.expectedText)assert.equal(actual.result.text,c.expectedText);
});
test('codec preserves natural-language conditions and nested application structure',()=>{
  const tree=core.parseMarkup(suite.application),roundtrip=core.parseMarkup(core.serializeMarkup(tree));
  delete tree.source;delete roundtrip.source;assert.deepEqual(roundtrip,tree);
  assert(!('selectTransition' in core));assert(!('compileApplication' in core));
});
