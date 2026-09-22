// SPDX-License-Identifier: Apache-2.0
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import {suite,runCase,fixture} from '../../../../../scripts/workflow-fixtures.mjs';
import {SessionOperations} from '../dist/operations.js';
import {McpServer} from '@psp-cdl/mcp-server';
import {signEnvelope} from '@psp-cdl/core/crypto';
import {serializeMarkup,envelopeToSection} from '@psp-cdl/core';
import {handleHttp} from '../dist/http.js';
const contract=JSON.parse(readFileSync(new URL('../../../../../schemas/api/workflow-0.1.openapi.json',import.meta.url),'utf8'));
const ajv=new Ajv2020({strict:false});
test('authorization context preserves the existing per-command and write-set size limits',async()=>{
  const f=await fixture();
  try {
    for(const version of [1,2]) {
      const r=await f.service.invoke('updateSession',{requestId:'large-'+version,sessionId:f.refs['@session'],expectedVersion:version,nodeId:'entry',nodeVersion:'1',status:'running',state:{stage:'large',payload:'x'.repeat(370000)}},'test-owner');
      assert.equal(r.result.version,version+1);
    }
  } finally {f.close();}
});
for(const c of suite.cases) test('workflow: '+c.id,async()=>{
  const report=await runCase(c,(step,response,body)=>{
    const schema=contract.components.schemas[response.status!==200?'Error':step.operation+'Response'];
    if(schema) assert(ajv.validate(schema,body),JSON.stringify(ajv.errors));
  });assert.deepEqual(report,c.expected);
  const steps=c.steps.filter(s=>!s.issue);
  for(const [i,r] of report.entries()) {
    assert(!JSON.stringify(r).includes('PRIVATE_'));
    assert(!JSON.stringify(r).includes('resumeToken'));
    const schema=contract.components.schemas[r.status!==200?'Error':steps[i].operation+'Response'];
    // Normalized identifiers are checked by the live-schema test below.
    if(schema&&r.status!==200) assert(ajv.validate(schema,r.body),JSON.stringify(ajv.errors));
  }
});
test('live wire responses satisfy output schemas and MCP discovery is scope filtered',async()=>{
  const f=await fixture();
  try {
    const server=new McpServer(f.service,()=> 'test-owner');
    await server.handle(JSON.stringify({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'test',version:'1'}}}));
    await server.handle(JSON.stringify({jsonrpc:'2.0',method:'notifications/initialized'}));
    const discovery=await server.handle(JSON.stringify({jsonrpc:'2.0',id:2,method:'tools/list'}));
    assert.equal(discovery.result.tools.length,8);
    const scenario=suite.cases.find(c=>c.id==='checkpoint-resume');
    for(const [index,step] of scenario.steps.entries()) {
      const result=await server.handle(JSON.stringify({jsonrpc:'2.0',id:index+3,method:'tools/call',params:{name:'realflow.'+({createCheckpoint:'checkpoints.create',resumeCheckpoint:'checkpoints.resume'}[step.operation]),arguments:f.replace(step.request)}}));
      if(index<3) {
        assert.equal(result.result.isError,false);const body=result.result.structuredContent;
        assert(ajv.validate(contract.components.schemas[step.operation+'Response'],body),JSON.stringify(ajv.errors));
        f.capture(step,body);
      } else assert.equal(result.result.isError,true);
    }
  } finally {f.close();}
});
test('operation handles are bounded, revocable, restart-local and refresh host snapshots',async()=>{
  const f=await fixture();
  try {
    const registry=new SessionOperations(f.store,f.host,1),id=await registry.issue(f.principal,f.refs['@session'],1800);
    await assert.rejects(()=>registry.issue(f.principal,f.refs['@session'],1800),{code:'OPERATION_CAPACITY'});
    const first=await registry.resolve(f.principal,id);
    assert.equal(first.verification.context['session-version'],'1');
    first.verification.context['node-id']='mutated';
    assert.equal((await registry.resolve(f.principal,id)).verification.context['node-id'],'entry');
    assert.equal(await new SessionOperations(f.store,f.host).resolve(f.principal,id),null);
    registry.revoke(id);assert.equal(await registry.resolve(f.principal,id),null);
    const next=await registry.issue(f.principal,f.refs['@session'],1800);
    const original=f.host.snapshot;
    f.host.snapshot=async(...args)=>{await f.store.execute(f.actor,{action:'updateSession',requestId:'during-snapshot',sessionId:f.refs['@session'],expectedVersion:1,nodeId:'next',nodeVersion:'1',policyVersion:'policy-1',status:'running',state:{stage:'changed'}});return original(...args);};
    await assert.rejects(()=>registry.resolve(f.principal,next),{code:'STALE_OPERATION'});
  } finally {f.close();}
});
test('session-bound verification requires exact signed bindings and fresh key status',async()=>{
  const f=await fixture();
  try {
    const key={id:'test',algorithm:'hmac-sha256',material:Buffer.alloc(32,9),status:'active',trustLevels:[2],sectionTypes:['context'],scope:{},allowUnscoped:false};
    const base=f.host.snapshot;
    f.host.snapshot=()=>({...base(),verification:{keys:[key],context:{},allowedAttributes:[]}});
    const id=await f.operations.issue(f.principal,f.refs['@session'],1800);
    const snapshot=await f.operations.resolve(f.principal,id);
    const content=attributes=>serializeMarkup({kind:'document',children:[envelopeToSection(signEnvelope('synthetic',{algorithm:'hmac-sha256',signatureVersion:'2.0',secretId:'test',timestamp:1000,expires:1500,version:'1.0.0',sectionType:'context',contentType:'text',attributes},key.material))]});
    const request={operation_id:id,sections:[{id:'good',content:content(snapshot.verification.context)},{id:'wrong-node',content:content({...snapshot.verification.context,'node-id':'other'})}]};
    const result=await f.service.invoke('verify',request,'test-owner');
    assert.deepEqual(result.summary,{total:2,valid:1,invalid:1});assert.equal(result.results[1].error,'SCOPE_MISMATCH');
    key.status='revoked';
    assert((await f.service.invoke('verify',request,'test-owner')).results.every(r=>r.error==='REVOKED_KEY'));
  } finally {f.close();}
});
test('HTTP pins identity before mutations and MCP filters workflow scopes',async()=>{
  const f=await fixture();
  try {
    const original=f.host.authenticate;let calls=0;
    f.host.authenticate=t=>++calls===1?original(t):{...original(t),subjectId:'changed'};
    const response=await handleHttp(f.service,f.request({operation:'updateSession',request:suite.cases.find(c=>c.id==='update-and-retry').steps[0].request}));
    assert.equal(response.status,403);assert.equal(f.backend.read('tenant-a',{kind:'session',id:f.refs['@session']}).revision,1);
    f.host.authenticate=original;
    const server=new McpServer(f.service,()=> 'test-reader');
    await server.handle(JSON.stringify({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'test',version:'1'}}}));
    await server.handle(JSON.stringify({jsonrpc:'2.0',method:'notifications/initialized'}));
    const result=await server.handle(JSON.stringify({jsonrpc:'2.0',id:2,method:'tools/list'}));
    assert.deepEqual(result.result.tools.map(t=>t.name),['realflow.sessions.get','realflow.nodes.fetch']);
  } finally {f.close();}
});
