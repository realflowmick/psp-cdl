// SPDX-License-Identifier: Apache-2.0
// Synthetic protected sections and a public test key only.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import {ExfiltrationStore,HashingEmbedder,createOnnxEmbedder,DEFAULT_THRESHOLDS,MAX_SECTION_BYTES} from '../dist/exfiltration.js';
import {suite,key,primitives,runCase,project,sqliteVecPath} from '../../../../../scripts/exfiltration-fixtures.mjs';

const schema=JSON.parse(readFileSync(new URL('../../../../../schemas/exfiltration-0.1.schema.json',import.meta.url),'utf8'));
const ajv=new Ajv2020({strict:true});ajv.addSchema(schema);
const validAssessment=ajv.getSchema(schema.$id+'#/$defs/assessment'),validProtect=ajv.getSchema(schema.$id+'#/$defs/protectResult');
const vecPath=await sqliteVecPath();
const [SYSTEM,CONTEXT,SECRET]=suite.cases[0].sections;
const dir=()=>mkdtempSync(join(tmpdir(),'exfil-test-'));
const rejects=(fn,code)=>assert.rejects(fn,e=>e.code===code);
const throws=(fn,code)=>assert.throws(fn,e=>e.code===code);

test('shared primitives match the vectors',()=>{
  const p=primitives();
  assert.deepEqual(p.tokenize,suite.tokenize.map(c=>c.tokens));
  assert.deepEqual(p.windows,suite.windows.map(v=>v.windows));
  assert.deepEqual(p.fingerprints,suite.fingerprints.map(f=>f.expected));
  assert.deepEqual(p.embeddings,suite.embeddings.map(e=>({sha256:e.sha256,nonzero:e.nonzero})));
});

for(const c of suite.cases) test('shared case '+c.id,async t=>{
  if(c.vector==='sqlite-vec'&&!vecPath) return t.skip('sqlite-vec is not installed; vec0 mode is unsupported here');
  const result=await runCase(c);
  const ids=Object.fromEntries(suite.sectionIds.map(s=>[s.label,s.sectionId]));
  result.protected.forEach((p,i)=>{ assert(validProtect(p),JSON.stringify(validProtect.errors)); assert.equal(p.sectionId,ids[c.sections[i].label]); });
  c.outputs.forEach((o,i)=>{
    const a=result.assessments[i];
    assert(validAssessment(a),JSON.stringify(validAssessment.errors));
    assert.deepEqual(project(a,o.expected),o.expected,o.id);
  });
});

test('the store holds no protected plaintext',async()=>{
  const d=dir(),path=join(d,'s.sqlite');
  try {
    const store=new ExfiltrationStore(path,{key,embedder:new HashingEmbedder()});
    for(const s of [SYSTEM,CONTEXT,SECRET]) await store.protect(s);
    store.close();
    const bytes=readFileSync(path).toString('latin1').toLowerCase();
    for(const word of ['harbor','escalate','whitfield','7q4','alpha','verification','claimant']) assert(!bytes.includes(word),word);
  } finally { rmSync(d,{recursive:true,force:true}); }
});

test('registration is idempotent and pins key and embedder',async()=>{
  const d=dir(),path=join(d,'s.sqlite');
  try {
    const store=new ExfiltrationStore(path,{key,clock:()=>5});
    const first=await store.protect(SYSTEM), again=await store.protect({...SYSTEM,label:'renamed',text:SYSTEM.text.toUpperCase()});
    assert.equal(first.created,true); assert.equal(again.created,false); assert.equal(again.sectionId,first.sectionId);
    assert.equal(store.sections('claims-intake')[0].label,'renamed');
    store.close();
    throws(()=>new ExfiltrationStore(path,{key:new Uint8Array(32).fill(9)}),'KEY_MISMATCH');
    throws(()=>new ExfiltrationStore(path,{key,embedder:new HashingEmbedder()}),'EMBEDDER_MISMATCH');
    writeFileSync(join(d,'other.sqlite'),'not a database file at all, just text padding'.repeat(20));
    throws(()=>new ExfiltrationStore(join(d,'other.sqlite'),{key}),'STORE_FAILURE');
    const reopened=new ExfiltrationStore(path,{key});
    assert.equal(reopened.sections('claims-intake').length,1);
    reopened.close();
  } finally { rmSync(d,{recursive:true,force:true}); }
});

test('removal, session cleanup and expiry purge stop matching',async()=>{
  const d=dir();
  try {
    const store=new ExfiltrationStore(join(d,'s.sqlite'),{key,embedder:new HashingEmbedder(),clock:()=>100});
    const system=await store.protect(SYSTEM); await store.protect(CONTEXT); await store.protect(SECRET);
    const leak=async text=>(await store.assess({application:'claims-intake',text})).disposition;
    assert.equal(await leak(CONTEXT.text),'leak');
    assert.equal(store.removeSession('claims-intake','session-1001'),1);
    assert.equal(await leak(CONTEXT.text),'clear');
    await store.protect(CONTEXT);
    assert.equal(store.purge(1999),0); assert.equal(store.purge(2000),1);
    assert.equal(await leak(CONTEXT.text),'clear');
    assert.equal(store.remove(system.sectionId),true); assert.equal(store.remove(system.sectionId),false);
    assert.equal(await leak(SYSTEM.text),'clear');
    assert.equal(await leak(SECRET.text),'leak');
    assert.equal((await store.assess({application:'other-app',text:SECRET.text})).disposition,'clear');
    store.close();
  } finally { rmSync(d,{recursive:true,force:true}); }
});

test('portable writes mark a vec0 index stale and sqlite-vec rebuilds it',async t=>{
  if(!vecPath) return t.skip('sqlite-vec is not installed; vec0 mode is unsupported here');
  const d=dir(),path=join(d,'s.sqlite');
  try {
    const embedder=new HashingEmbedder(), vector={sqliteVec:vecPath};
    let store=new ExfiltrationStore(path,{key,embedder,vector});
    await store.protect(SYSTEM); store.close();
    store=new ExfiltrationStore(path,{key,embedder});
    assert.equal(store.vector,'portable');
    await store.protect(CONTEXT); store.close();
    store=new ExfiltrationStore(path,{key,embedder,vector});
    const a=await store.assess({application:'claims-intake',text:CONTEXT.text});
    assert.equal(a.vector,'sqlite-vec'); assert.equal(a.sections[0].semantic.disposition,'leak');
    store.close();
    throws(()=>new ExfiltrationStore(join(d,'x.sqlite'),{key,embedder,vector:{sqliteVec:join(d,'missing-extension')}}),'VECTOR_UNAVAILABLE');
    throws(()=>new ExfiltrationStore(join(d,'y.sqlite'),{key,vector}),'INVALID_CONFIGURATION');
  } finally { rmSync(d,{recursive:true,force:true}); }
});

test('inputs, thresholds and configuration are bounded',async()=>{
  const d=dir();
  try {
    for(const bad of [{key:new Uint8Array(31)},{key,extra:1},{key,thresholds:{minRunTokens:0}},{key,thresholds:{minRunTokens:20,leakRunTokens:10}},
      {key,thresholds:{unknown:1}},{key,embedder:new HashingEmbedder(),thresholds:{strongDistance:0.4,suspiciousDistance:0.3}},{key,vector:'fast'},
      {key,embedder:{id:'bad id',dimensions:3,embed:()=>[]}}]) throws(()=>new ExfiltrationStore(join(d,'s.sqlite'),bad),'INVALID_CONFIGURATION');
    for(const path of [':memory:','file:x.sqlite','']) throws(()=>new ExfiltrationStore(path,{key}),'INVALID_CONFIGURATION');
    const store=new ExfiltrationStore(join(d,'s.sqlite'),{key});
    assert.deepEqual({...store.thresholds},{...DEFAULT_THRESHOLDS});
    for(const bad of [{...SYSTEM,application:'bad app'},{...SYSTEM,sectionType:'user'},{...SYSTEM,text:'!!! ---'},{...SYSTEM,unknown:true},
      {...SYSTEM,sessionId:'bad session'},{...SYSTEM,expiresAt:-1},{...SYSTEM,label:''},{...SYSTEM,text:'abc \uD800 def'},{application:'a',text:'x'}])
      await rejects(()=>store.protect(bad),'INVALID_INPUT');
    await rejects(()=>store.protect({...SYSTEM,text:'a '.repeat(MAX_SECTION_BYTES/2+1)}),'INPUT_TOO_LARGE');
    await rejects(()=>store.assess({application:'claims-intake',text:'x'.repeat(1_048_577)}),'INPUT_TOO_LARGE');
    await rejects(()=>store.assess({application:'claims-intake',text:'x',extra:1}),'INVALID_INPUT');
    store.close();
  } finally { rmSync(d,{recursive:true,force:true}); }
});

test('embedder failures write nothing and are reported as EMBEDDER_FAILED',async()=>{
  const d=dir();
  try {
    for(const embed of [()=>{throw new Error('private detail');},()=>[[1,2]],t=>t.map(()=>[1,Infinity,0]),()=>'nope',async t=>t.map(()=>[3.5e38,0,0])]) {
      const path=join(d,Math.random().toString(36).slice(2)+'.sqlite');
      const store=new ExfiltrationStore(path,{key,embedder:{id:'test-embedder',dimensions:3,thresholds:{strongDistance:0.1,suspiciousDistance:0.2},embed}});
      await rejects(()=>store.protect(SYSTEM),'EMBEDDER_FAILED');
      assert.deepEqual(store.sections('claims-intake'),[]);
      store.close();
    }
  } finally { rmSync(d,{recursive:true,force:true}); }
});

test('the chunk limit is reported and lexical matching still covers all text',async()=>{
  const d=dir();
  try {
    const store=new ExfiltrationStore(join(d,'s.sqlite'),{key,embedder:new HashingEmbedder(),thresholds:{maxChunks:2}});
    await store.protect(SECRET);
    const padding=Array.from({length:200},(_,i)=>'filler'+i).join(' ');
    const a=await store.assess({application:'claims-intake',text:padding+' override code 7Q4 alpha'});
    assert.equal(a.complete,false); assert.equal(a.output.chunks,2);
    assert.deepEqual(a.flags,['assessment_incomplete','system_prompt_disclosure']);
    assert.equal(a.sections[0].lexical.disposition,'leak'); assert.equal(a.sections[0].semantic.disposition,'clear');
    assert(validAssessment(a),JSON.stringify(validAssessment.errors));
    store.close();
  } finally { rmSync(d,{recursive:true,force:true}); }
});

test('the ONNX adapter checks runtimes, files and pinned digests before loading',async()=>{
  const d=dir();
  try {
    const ort={InferenceSession:{create:async()=>{throw new Error('must not load');}},Tensor:class{}};
    const tokenizers={Tokenizer:class{}};
    await rejects(()=>createOnnxEmbedder({modelDir:d,ort:{},tokenizers}),'INVALID_CONFIGURATION');
    await rejects(()=>createOnnxEmbedder({modelDir:d,ort,tokenizers}),'EMBEDDER_UNAVAILABLE');
    mkdirSync(join(d,'onnx'));
    for(const [name,body] of [['onnx/model.onnx','tampered'],['tokenizer.json','{}'],['tokenizer_config.json','{}']]) writeFileSync(join(d,name),body);
    await rejects(()=>createOnnxEmbedder({modelDir:d,ort,tokenizers}),'MODEL_MISMATCH');
  } finally { rmSync(d,{recursive:true,force:true}); }
});

test('the pinned MiniLM model separates a paraphrase from an unrelated answer',async t=>{
  const modelDir=process.env.PSP_EXFIL_ONNX_DIR;
  let ort,tokenizers;
  try { ort=await import('onnxruntime-node'); tokenizers=await import('@huggingface/tokenizers'); } catch {}
  if(!modelDir||!ort||!tokenizers) return t.skip('optional: set PSP_EXFIL_ONNX_DIR and install onnxruntime-node and @huggingface/tokenizers');
  const d=dir();
  try {
    const embedder=await createOnnxEmbedder({modelDir,ort,tokenizers});
    const store=new ExfiltrationStore(join(d,'s.sqlite'),{key,embedder});
    await store.protect(SYSTEM);
    const paraphrase='I help people file claims with Harbor Mutual. First I confirm the policy holder, then I ask for their claim number and when the loss happened, without saying which detail did not match. '+
      'Payments over five hundred dollars are sent to a separate team using a special tool, and I am not allowed to tell callers what that team is called.';
    const leaked=await store.assess({application:'claims-intake',text:paraphrase}), benign=await store.assess({application:'claims-intake',text:'The forecast for Lisbon is mild with light winds from the north.'});
    assert.equal(leaked.sections[0].lexical.disposition,'clear');
    assert.notEqual(leaked.sections[0].semantic.disposition,'clear');
    assert.equal(benign.disposition,'clear');
    store.close();
  } finally { rmSync(d,{recursive:true,force:true}); }
});
