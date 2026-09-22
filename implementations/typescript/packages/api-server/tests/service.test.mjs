// SPDX-License-Identifier: Apache-2.0
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {request as httpRequest} from 'node:http';
import Ajv2020 from 'ajv/dist/2020.js';
import {handleHttp,createHttpServer} from '../dist/http.js';
import {MAX_REQUEST_BYTES} from '../dist/index.js';
import {suite,fixture} from '../../../../../scripts/service-fixtures.mjs';
const contract=JSON.parse(readFileSync(new URL('../../../../../schemas/api/security-0.1.openapi.json',import.meta.url),'utf8'));
const ajv=new Ajv2020({strict:false});
for(const c of suite.httpCases) test(c.id,async()=>{
  const f=fixture(c),response=await handleHttp(f.service,f.request),body=JSON.parse(response.body);
  assert.deepEqual({status:response.status,body},c.expected);
  const kind=response.status!==200?'Error':c.path==='/v1/security/verify'?'VerifyResponse':'EvaluateResponse';
  assert(ajv.validate(contract.components.schemas[kind],body),JSON.stringify(ajv.errors));
  assert.equal(response.headers['cache-control'],'no-store');
  assert(!response.body.includes('PRIVATE_BACKEND_DETAIL'));
  if([400,401,403,405,415].includes(response.status)) assert.equal(f.resolutions(),0);
});
test('oversized and invalid UTF-8 bodies fail before policy lookup',async()=>{
  for(const [body,status] of [[Buffer.alloc(MAX_REQUEST_BYTES+1),413],[Buffer.from([0xff]),400]]) {
    const f=fixture(),result=await handleHttp(f.service,{...f.request,body});
    assert.equal(result.status,status);assert.equal(f.resolutions(),0);
  }
});
test('identity is pinned across transport reauthentication and mixed batches count every section',async()=>{
  const f=fixture();
  await assert.rejects(()=>f.service.invoke('evaluate',{operation_id:'op-1'},'public-token-a',{tenantId:'tenant-b',subjectId:'subject-a',scopes:[]}),{code:'FORBIDDEN'});
  assert.equal(f.resolutions(),0);
  const good=suite.httpCases.find(c=>c.id==='verify-valid').request.sections[0];
  const bad=suite.httpCases.find(c=>c.id==='verify-tampered').request.sections[0];
  const result=await f.service.invoke('verify',{operation_id:'op-1',sections:[good,{...bad,id:'s2'}]},'public-token-a');
  assert.deepEqual(result.summary,{total:2,valid:1,invalid:1});
});
test('real loopback HTTP requests pass through the authenticated adapter',async()=>{
  const f=fixture(),server=createHttpServer(f.service);
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try {
    const url='http://127.0.0.1:'+server.address().port+'/v1/policy/evaluate';
    const response=await fetch(url,{method:'POST',headers:Object.fromEntries(f.request.headers),body:f.request.body});
    assert.equal(response.status,200);assert.equal((await response.json()).decision,'deny');
    const denied=await fetch(url,{method:'POST',body:'{bad'});assert.equal(denied.status,401);assert.equal(f.resolutions(),1);
    const status=await new Promise((resolve,reject)=>{const req=httpRequest(url,{method:'POST',headers:{...Object.fromEntries(f.request.headers),host:'attacker.test'}},res=>{res.resume();res.on('end',()=>resolve(res.statusCode));});req.on('error',reject);req.end(f.request.body);});assert.equal(status,403);
  } finally {server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
