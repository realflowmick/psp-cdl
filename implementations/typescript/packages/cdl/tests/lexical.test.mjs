// SPDX-License-Identifier: Apache-2.0
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {tokenizeDeclaration,normalizeDeclaration} from '../dist/index.js';
const suite=JSON.parse(readFileSync(new URL('../../../../../conformance/vectors/codec/cdl-lexical-0.1.json',import.meta.url),'utf8'));
for(const c of suite.cases)test('lexical: '+c.id,()=>{
  const input=c.repeatText?c.repeatText.repeat(c.count):c.repeatArray?Array(c.count).fill(c.repeatArray):c.input;
  if(c.error)assert.throws(()=>tokenizeDeclaration(input),{code:c.error});
  else assert.deepEqual(tokenizeDeclaration(input),c.terms);
});
test('lexical acceptance does not authorize typed policy or change typed precedence',()=>{
  for(const kind of ['classes','covenants'])assert.throws(()=>normalizeDeclaration(kind,'PII no-training'),{code:'UNSUPPORTED_TERM'});
  assert.throws(()=>normalizeDeclaration('classes',['!no-training','x'.repeat(129)]),{code:'INVALID_DECLARATION'});
  assert.throws(()=>normalizeDeclaration('covenants',['no-training','!no-training']),{code:'CONTRADICTORY_DECLARATION'});
  assert.deepEqual(normalizeDeclaration('classes',['restricted','pii']),['pii','restricted']);
});
