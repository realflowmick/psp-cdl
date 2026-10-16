// SPDX-License-Identifier: Apache-2.0
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import Ajv from 'ajv';
import {
  formatPspp,parsePspp,parseConfig,formatBody,formatConfig,pipelineJsonSchema,checkConfig,PipelineFormatError,ringOrder,structuralEdges,attachment,
  validatePipeline,registrationsFor,newPipeline,spliceRing,insertFilter,moveFilter,removeFilter,applyEdits,renameComponent,removeComponent,tap,createComponent,
  addComponent,nextFire,parseCron,conflicts,serverName,bodyOf,PSPP_FORMAT
} from '../dist/index.js';

const EXAMPLE=readFileSync(new URL('../../../examples/pipelines/evaluator-ring.pspp',import.meta.url),'utf8');
const SCHEMA=JSON.parse(readFileSync(new URL('../schemas/pipeline.schema.json',import.meta.url),'utf8'));
const example=()=>parsePspp(EXAMPLE);
const summary=(extra={})=>({pointer:'env:PSP_DOC',path:'intake.psp',source:'env',format:'psp',parses:true,signed:false,nodes:[{id:'intake_review',version:'v1',agents:['mcp://crm/lookup']}],
  entryNode:{id:'intake_review',version:'v1',agents:['mcp://crm/lookup']},covenants:['no-log','no-external-transmission'],classes:[],
  sections:[{type:'system',ref:'intake_review',signature:'missing',classes:[],covenants:[],bytes:40},{type:'context',ref:'account_record',signature:'valid',classes:[],covenants:['no-log','no-external-transmission'],bytes:80}],...extra});
const catalog={proxyId:'mcpproxy_1',backend:'https://mcp.internal/crm',digest:'d',capturedAt:'2026-10-13T00:00:00.000Z',
  tools:[{name:'lookup',readOnly:true,capabilities:[]},{name:'notes',readOnly:true,capabilities:[]},{name:'send_mail',readOnly:false,capabilities:['can-send-email']}]};
const codes=problems=>problems.map(p=>p.code);

test('the worked example round-trips byte for byte and matches the generated schema',()=>{
  const config=example();
  assert.equal(formatPspp(config),EXAMPLE);
  assert.equal(formatPspp(parsePspp(formatPspp(config))),EXAMPLE);
  assert.equal(config.$format,undefined);
  assert.deepEqual(SCHEMA,JSON.parse(JSON.stringify(pipelineJsonSchema())),'Run node scripts/generate-pipeline-schema.mjs');
  const validate=new Ajv({strict:false,allErrors:true}).compile(SCHEMA);
  assert.equal(validate(JSON.parse(EXAMPLE)),true,JSON.stringify(validate.errors));
  for(const bad of [{...JSON.parse(EXAMPLE),extra:1},{...JSON.parse(EXAMPLE),psp:{}},{...JSON.parse(EXAMPLE),components:[{id:'m',kind:'model',role:'terminal'}]}])assert.equal(validate(bad),false);
});

test('serialization is canonical: role groups, kind key order, unknown keys kept after known ones',()=>{
  const config={name:'x',psp:{signOnRetrieval:'ed25519',document:'a.psp'},components:[
    {role:'aux',kind:'logger',id:'log_1',redact:'covenant',taps:'llmproxy_1.response'},
    {model:'gpt-4.1',role:'terminal',kind:'model',id:'model_1'},
    {custom:true,filters:{response:[{threshold:0.2,kind:'exfil-guard'}],request:[]},kind:'llmproxy',id:'llmproxy_1',role:'ring'}]};
  const text=formatConfig(config);
  const parsed=JSON.parse(text);
  assert.deepEqual(Object.keys(parsed),['name','psp','components']);
  assert.deepEqual(Object.keys(parsed.psp),['document','signOnRetrieval']);
  assert.deepEqual(parsed.components.map(c=>c.id),['llmproxy_1','model_1','log_1']);
  assert.deepEqual(Object.keys(parsed.components[0]),['id','kind','role','filters','custom']);
  assert.deepEqual(Object.keys(parsed.components[0].filters),['request','response']);
  assert.deepEqual(Object.keys(parsed.components[0].filters.response[0]),['kind','threshold']);
  assert.deepEqual(Object.keys(parsed.components[2]),['id','kind','role','taps','redact']);
  assert.equal(formatConfig(parseConfig(text)),text);
  assert.equal(JSON.parse(formatBody(config)).name,undefined);
});

test('import rejects what the schema rejects and names the path',()=>{
  assert.throws(()=>parsePspp('{'),{code:'INVALID_JSON'});
  assert.throws(()=>parsePspp(JSON.stringify({name:'x',psp:null,components:[]})),{code:'UNSUPPORTED_FORMAT'});
  const bad={$format:PSPP_FORMAT,name:'x',psp:null,components:[{id:'m',kind:'mcpproxy',role:'loop',caller:'model_1',backend:'https://x/y',drift:'maybe'}]};
  assert.throws(()=>parsePspp(JSON.stringify(bad)),e=>e instanceof PipelineFormatError&&e.issues.some(i=>i.startsWith('/components/0/drift')));
  assert.throws(()=>checkConfig({name:'a/b',psp:null,components:[]}),{code:'SCHEMA_VIOLATION'});
  assert.throws(()=>checkConfig({name:'x',psp:null,components:[{id:'1bad',kind:'model',role:'terminal',model:'m'}]}),{code:'SCHEMA_VIOLATION'});
  // Unknown kinds load with their keys intact.
  const ext=checkConfig({name:'x',psp:null,components:[{id:'redactor_1',kind:'redactor',role:'ring',side:'response',level:3}]});
  assert.equal(ext.components[0].level,3);
});

test('the ring, tool loop, bootstrap and taps are derived from roles',()=>{
  const config=example();
  assert.deepEqual(ringOrder(config),['initiator_1','llmproxy_1.request','model_1','llmproxy_1.response','initiator_1']);
  const edges=structuralEdges(config).map(e=>`${e.kind}:${e.source}->${e.target}`);
  for(const e of ['request:initiator_1->llmproxy_1.request','request:llmproxy_1.request->model_1','response:model_1->llmproxy_1.response','response:llmproxy_1.response->initiator_1',
    'loop:model_1->mcpproxy_1','loop-return:mcpproxy_1->model_1','backend:mcpproxy_1->mcpproxy_1.backend','aux:llmproxy_1.response->log_1','aux:llmproxy_1.response->protected_vectors',
    'bootstrap:psp-document->llmproxy_1.request','bootstrap:psp-context->llmproxy_1.request'])assert.ok(edges.includes(e),e);
  const open=applyEdits(config,[{op:'set',path:['components',2,'reply'],value:'none'}]);
  assert.ok(structuralEdges(open).some(e=>e.target==='terminator'));
  assert.ok(!structuralEdges(open).some(e=>e.kind==='response'&&e.target==='initiator_1'));
  assert.equal(structuralEdges({...config,psp:null}).filter(e=>e.kind==='bootstrap').length,0);
  assert.equal(serverName(config.components[3]),'crm');
});

test('a filter dropped into slot 1 changes exactly one entry',()=>{
  const config=example();
  const without=applyEdits(config,[{op:'set',path:['components',0,'filters','response'],value:[{kind:'exfil-guard',threshold:0.15},{kind:'data-use-check',scope:'context'}]}]);
  const after=insertFilter(without,'llmproxy_1','response',1,'covenant-gate');
  assert.equal(formatPspp(after),EXAMPLE);
  const before=formatBody(without).split('\n'),next=formatBody(after).split('\n');
  assert.equal(next.length-before.length,1);
  assert.deepEqual(next.filter((l,i)=>l!==before[i]).slice(0,1),['          "covenant-gate",']);
  const moved=moveFilter(after,'llmproxy_1','response',2,0);
  assert.deepEqual(moved.components[0].filters.response.map(f=>typeof f==='string'?f:f.kind),['data-use-check','exfil-guard','covenant-gate']);
  assert.equal(removeFilter(moved,'llmproxy_1','response',0).components[0].filters.response.length,2);
});

test('splicing a ring component places it on the edge it was dropped on',()=>{
  const config=example();
  const comp=createComponent(config,'redactor',{role:'ring'});
  const req=spliceRing(config,comp,{side:'request',source:'llmproxy_1.request',target:'model_1'});
  assert.deepEqual(ringOrder(req),['initiator_1','llmproxy_1.request','redactor_1','model_1','llmproxy_1.response','initiator_1']);
  const res=spliceRing(config,comp,{side:'response',source:'model_1',target:'llmproxy_1.response'});
  assert.deepEqual(ringOrder(res),['initiator_1','llmproxy_1.request','model_1','redactor_1','llmproxy_1.response','initiator_1']);
  assert.equal(res.components.find(c=>c.id==='redactor_1').side,'response');
  assert.throws(()=>spliceRing(config,createComponent(config,'llmproxy'),{side:'request',source:'initiator_1',target:'llmproxy_1.request'}),{code:'SINGLETON'});
});

test('a new pipeline is an empty ring without a PSP',()=>{
  const config=newPipeline('fresh');
  assert.deepEqual(ringOrder(config),['initiator_1','llmproxy_1.request','model_1','llmproxy_1.response','initiator_1']);
  assert.deepEqual(codes(validatePipeline(config)).sort(),['NO_PSP']);
  assert.equal(validatePipeline(config).find(p=>p.code==='NO_PSP').message,'Runs without a PSP — no node allowlist, no covenants, psp-verify skipped.');
});

test('free nodes, dangling references, duplicates and collisions are errors with quick fixes where one exists',()=>{
  let config=example();
  const logger=createComponent(config,'logger');
  config=addComponent(config,logger);
  assert.equal(attachment(config,config.components.at(-1)),'free');
  const free=validatePipeline(config).find(p=>p.code==='FREE_NODE');
  assert.equal(free.severity,'error');assert.equal(free.target.componentId,'log_2');
  const fixed=applyEdits(config,free.fix.edits);
  assert.equal(fixed.components.at(-1).taps,'llmproxy_1.response');
  assert.ok(!codes(validatePipeline(fixed)).includes('FREE_NODE'));
  assert.deepEqual(tap(config,'log_2','llmproxy_1').components.at(-1).taps,'llmproxy_1.response');
  const dangling=applyEdits(example(),[{op:'set',path:['components',0,'vectorStore'],value:'nope'}]);
  const d=validatePipeline(dangling).find(p=>p.code==='DANGLING_REFERENCE');
  assert.ok(d);assert.ok(!codes(validatePipeline(applyEdits(dangling,d.fix.edits))).includes('DANGLING_REFERENCE'));
  const dup=applyEdits(example(),[{op:'set',path:['components',5,'id'],value:'model_1'}]);
  assert.ok(codes(validatePipeline(dup)).includes('DUPLICATE_ID'));
  assert.ok(codes(validatePipeline(example(),{otherNames:['evaluator-ring']})).includes('NAME_COLLISION'));
  const twoModels={...example(),components:[...example().components,{id:'model_2',kind:'model',role:'terminal',model:'gpt-4.1'}]};
  assert.ok(codes(validatePipeline(twoModels)).includes('EXTRA_COMPONENT'));
  assert.ok(codes(validatePipeline(removeComponent(example(),'model_1'))).includes('MISSING_MODEL'));
  assert.equal(removeComponent(example(),'protected_vectors').components[0].vectorStore,undefined);
  const renamed=renameComponent(example(),'llmproxy_1','proxy');
  assert.equal(renamed.components.find(c=>c.id==='log_1').taps,'proxy.response');
});

test('the referenced PSP drives the pointer, signing, pruning, sink and tap results',()=>{
  const config=applyEdits(example(),[{op:'set',path:['components',3,'serverInfo'],value:{name:'crm',version:'1'}}]);
  const env={psp:{status:'resolved',summary:summary({entryNode:{id:'intake_review',version:'v1',agents:['mcp://crm/lookup','mcp://crm/send_mail']}})},catalogs:{mcpproxy_1:catalog},signing:{configured:false,algorithm:null},embedders:['psp-exfil-hash-384-v1']};
  const problems=validatePipeline(config,env);
  const byCode=code=>problems.filter(p=>p.code===code).map(p=>p.message);
  assert.deepEqual(byCode('PSP_RESOLVED'),['PSP document resolved from PSP_DOC (intake.psp), signed on retrieval (ed25519), bound to the session.']);
  assert.deepEqual(byCode('COVENANT_PRUNED'),['Covenant pruning withholds crm.send_mail: account_record carries no-external-transmission.']);
  assert.deepEqual(byCode('TAP_REDACTED'),['Logger log_1 taps the response while account_record carries no-log. It will receive redacted records for this session.']);
  assert.match(byCode('REGISTRATIONS')[0],/For node intake_review, 1 of 3 backend tools are registered: crm\.lookup/);
  assert.ok(byCode('EMBEDDER_UNAVAILABLE').length);
  assert.ok(codes(problems).includes('EPHEMERAL_KEY'));
  // Unsigned and not signed on retrieval.
  const unsigned=validatePipeline({...config,psp:{document:'env:PSP_DOC'}},env).find(p=>p.code==='PSP_UNSIGNED');
  assert.equal(unsigned.severity,'error');
  assert.equal(applyEdits({...config,psp:{document:'env:PSP_DOC'}},unsigned.fix.edits).psp.signOnRetrieval,'ed25519');
  // Unresolved pointer.
  assert.ok(codes(validatePipeline(config,{psp:{status:'unresolved',pointer:'env:PSP_DOC',reason:'PSP_DOC is not set on the studio server.'}})).includes('PSP_UNRESOLVED'));
  // A file sink conflicts with no-persist.
  const file=applyEdits(config,[{op:'set',path:['components',2],value:{id:'initiator_1',kind:'initiator',role:'terminal',trigger:'file',watch:'inbox/*.txt',reply:'channel',output:'out',onDone:'move'}}]);
  const persisted={psp:{status:'resolved',summary:summary({covenants:['no-persist'],sections:[{type:'context',ref:'account_record',signature:'valid',classes:[],covenants:['no-persist'],bytes:1}]})}};
  assert.deepEqual(validatePipeline(file,persisted).filter(p=>p.code==='SINK_COVENANT').map(p=>p.message),['account_record carries no-persist: replies on this file channel will be withheld by Covenant Gate.']);
  // CDL has no no-email; the validator says so.
  const noEmail={psp:{status:'resolved',summary:summary({covenants:['no-email']})}};
  assert.match(validatePipeline(config,noEmail).find(p=>p.code==='UNKNOWN_COVENANT').message,/no-external-transmission covers email/);
});

test('registrations follow node affinity, covenant pruning and the read-only rule',()=>{
  const config=applyEdits(example(),[{op:'set',path:['components',3,'tools'],value:{notes:{readOnly:true},lookup:{readOnly:true}}}]);
  const psp=summary({entryNode:{id:'intake_review',version:'v1',agents:['mcp://crm/lookup','mcp://crm/send_mail']}});
  assert.deepEqual(registrationsFor(config,psp,{mcpproxy_1:catalog}),{node:'intake_review',allowed:['crm.lookup'],withheldByNode:['crm.notes'],withheldByCovenant:[{tool:'crm.send_mail',covenant:'no-external-transmission'}],withheldByMode:[],unknownBackends:[]});
  const noPruning=applyEdits(config,[{op:'set',path:['components',0,'filters','request'],value:['psp-verify']}]);
  assert.deepEqual(registrationsFor(noPruning,psp,{mcpproxy_1:catalog}),{node:'intake_review',allowed:['crm.lookup','crm.notes'],withheldByNode:[],withheldByCovenant:[],withheldByMode:['crm.send_mail'],unknownBackends:[]});
  assert.deepEqual(registrationsFor(config,null,{}).unknownBackends,['mcpproxy_1']);
  assert.equal(conflicts('no-log','covenant',['logs-data']),true);
  assert.equal(conflicts('audit-required','covenant',[]),false);
  assert.equal(conflicts('no-email','covenant',['can-send-email']),false);
});

test('initiator triggers need their keys; reply none with nothing that acts warns',()=>{
  const base=example();
  const set=value=>applyEdits(base,[{op:'set',path:['components',2],value:{id:'initiator_1',kind:'initiator',role:'terminal',...value}}]);
  assert.ok(validatePipeline(set({trigger:'file'})).some(p=>p.code==='TRIGGER_CONFIG'&&/watch/.test(p.message)));
  assert.ok(validatePipeline(set({trigger:'file',watch:'in/*.txt'})).some(p=>p.code==='TRIGGER_CONFIG'&&/output/.test(p.message)));
  assert.ok(!validatePipeline(set({trigger:'file',watch:'in/*.txt',reply:'none'})).some(p=>p.code==='TRIGGER_CONFIG'));
  assert.ok(validatePipeline(set({trigger:'schedule',cron:'every day',prompt:'x'})).some(p=>p.code==='TRIGGER_CONFIG'&&/cron/.test(p.message)));
  const email=set({trigger:'email',mailbox:'intake@keystone.example',reply:'none'});
  assert.ok(validatePipeline(email,{catalogs:{mcpproxy_1:{...catalog,tools:catalog.tools.slice(0,1)}}}).some(p=>p.code==='NO_OUTCOME'));
  assert.match(validatePipeline(email,{catalogs:{mcpproxy_1:catalog}}).find(p=>p.code==='NO_OUTCOME').message,/crm\.send_mail/);
});

test('cron parsing and next fire time',()=>{
  assert.equal(parseCron('*/15 9-17 * * 1-5')?.length,5);
  assert.equal(parseCron('61 * * * *'),null);
  assert.equal(nextFire('30 9 * * *',new Date('2026-10-14T09:30:00Z')).toISOString(),'2026-10-15T09:30:00.000Z');
  assert.equal(nextFire('0 0 * * 0',new Date('2026-10-14T00:00:00Z')).toISOString(),'2026-10-18T00:00:00.000Z');
  assert.equal(nextFire('0 0 31 2 *',new Date('2026-10-14T00:00:00Z')),null);
  assert.deepEqual(bodyOf(example()).components.length,6);
});
