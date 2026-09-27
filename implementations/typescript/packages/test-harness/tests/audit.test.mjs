// SPDX-License-Identifier: Apache-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import {auditResultManifest,signResultManifest} from '@psp-cdl/test-harness';
import {suite,auditInput,runAuditCase} from '../../../../../scripts/audit-fixtures.mjs';
const validate=new Ajv2020({strict:true}).compile(JSON.parse(readFileSync(new URL('../../../../../schemas/result-audit-0.1.schema.json',import.meta.url),'utf8')));
for(const c of suite.cases)test('result audit: '+c.id,()=>{
  const result=runAuditCase(c);assert.equal(result.code,c.expectedCode);
  if(result.code!=='OK')return;
  const r=result.report;assert(validate(r),JSON.stringify(validate.errors));
  assert.equal(r.status,c.expectedStatus);
  assert.deepEqual(r.checks.filter(v=>!v.matches).map(v=>v.artifact),c.mismatches??[]);
  assert.equal(r.runStatus,c.runStatus??'finalized');assert.equal(r.recovered,c.recovered??false);
  assert.equal(r.trials,96);
  assert.deepEqual(r.evidenceSources,c.id==='all-unstarted'?{record:0,observation:0,partial:0,skipped:96}:{record:2,observation:1,partial:3,skipped:90});
  assert.equal(r.executionAuthorized,false);assert.equal(r.independentReview,false);
});
test('audit authenticates before artifact access, and reads each file once',()=>{
  const {envelope,policy,files}=auditInput(suite.cases[0]),seen=new Set(),before=JSON.stringify(envelope);
  const r=auditResultManifest(envelope,policy,name=>{assert(!seen.has(name));seen.add(name);return files[name];});
  assert.equal(r.status,'reproduced');assert.equal(seen.size,Object.keys(files).length);assert.equal(JSON.stringify(envelope),before);
  assert.throws(()=>auditResultManifest(envelope,{...policy,status:'revoked'},()=>assert.fail('reader called')),e=>e.code==='REVOKED_RESULT_KEY');
});
test('audit refuses oversized snapshots before reading files',()=>{
  const {envelope,policy}=auditInput(suite.cases[0]);
  for(const f of envelope.manifest.artifacts)f.bytes=4194304;
  const seed=Buffer.from(Array.from({length:32},(_,i)=>i));
  const signed=signResultManifest(envelope.manifest,policy.keyId,0,seed);
  assert.throws(()=>auditResultManifest(signed,policy,()=>assert.fail('reader called')),e=>e.code==='AUDIT_LIMIT_EXCEEDED');
});
test('snapshot detaches mutable reader buffers before later callbacks',()=>{
  const {envelope,policy,files}=auditInput(suite.cases[0]);let previous;
  const r=auditResultManifest(envelope,policy,name=>{if(previous)previous.fill(0);previous=files[name];return previous;});
  assert.equal(r.status,'reproduced');
});
