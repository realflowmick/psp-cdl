// SPDX-License-Identifier: Apache-2.0
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Readable,Writable} from 'node:stream';
import {suite,runMediationCase,mediationFixture,messages} from '../../../../../scripts/mediation-fixtures.mjs';
import {serveStdio} from '@psp-cdl/mcp-server/stdio';
import {readFileSync} from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
const readSchema=name=>JSON.parse(readFileSync(new URL('../../../../../schemas/'+name+'.schema.json',import.meta.url),'utf8'));
const schema=readSchema('mcp-stdio'),validate=new Ajv2020().addSchema(readSchema('mcp-dispatch')).addSchema(schema).compile({$ref:schema.$id+'#/$defs/proxyResult'});
for(const c of suite.cases) test(c.id,async()=>{
  const result=await runMediationCase(c);
  for(const [k,v] of Object.entries(c.expected))assert.deepEqual(result[k],v,JSON.stringify(result));
  assert(!JSON.stringify(result).includes('PRIVATE_'));
  if(result.code==='OK') {
    assert(validate(result.result),JSON.stringify(validate.errors));
    assert.deepEqual(result.result.structuredContent,{message:'hello 🧪'});
    assert.equal(result.result._meta['psp-cdl/provenance'].trustLevel,5);
  }
});
test('host cancellation closes a hung downstream without releasing output or retaining owner reservation',async()=>{
  const f=await mediationFixture({mode:'hang'});
  try {
    const pending=f.gate.callTool('test-owner',f.f.session.sessionId,{name:'echo.read',arguments:{message:'test'}},f.f.options);
    const timer=setInterval(()=>{if(f.calls())f.f.flags.cancelled=true;},10);
    try {await assert.rejects(()=>pending,{code:'CANCELLED'});}finally{clearInterval(timer);}
    assert.equal(f.calls(),1);
    assert.equal((await f.f.update()).version,2);
  }finally{await f.close();}
});
test('connection identity cannot switch after initialization',async()=>{
  const c={},f=await mediationFixture(c);
  try {
    for(const m of messages(c).slice(0,2))await f.server.handle(JSON.stringify(m));
    c.token='test-other';
    assert.equal((await f.server.handle(JSON.stringify(messages()[3]))).error.message,'IDENTITY_CHANGED');
    assert.equal(f.calls(),0);
  }finally{await f.close();}
});
test('stdio checks the serialized output bound before emitting any bytes',async()=>{
  const chunks=[],output=new Writable({write(c,_e,done){chunks.push(c);done();}});
  await assert.rejects(()=>serveStdio({handle:async()=>({value:'x'.repeat(1_048_576)})},Readable.from(['{}\n']),output),/FRAME_TOO_LARGE/);
  assert.equal(chunks.length,0);
});
