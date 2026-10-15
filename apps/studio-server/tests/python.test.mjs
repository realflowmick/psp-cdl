// SPDX-License-Identifier: Apache-2.0
// A fake launcher stands in for the uv python launcher; the real engines are exercised by the parity suite.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync,existsSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {PythonEngine,Vault,Workspace} from '../dist/index.js';

const repoRoot=resolve(fileURLToPath(new URL('../../../',import.meta.url)));
const FAKE=String.raw`
const [script,command,...rest]=process.argv.slice(2);
const fs=require('node:fs'),path=require('node:path');
const arg=name=>{const i=rest.indexOf(name);return i<0?null:rest[i+1];};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
  if(script.endsWith('campaign.py')){
    if(command==='prepare'){
      const config=JSON.parse(fs.readFileSync(arg('--config'),'utf8'));
      fs.mkdirSync(path.dirname(arg('--output')),{recursive:true});
      fs.writeFileSync(arg('--output'),JSON.stringify({plan:config.caseIds.map(id=>({id}))}));
      console.log(JSON.stringify({bundle:arg('--output'),sha256:'digest-'+config.caseIds.length,episodes:config.caseIds.length,reservedMicroUsd:0}));
    } else if(command==='run'){
      const out=arg('--output');fs.mkdirSync(out,{recursive:true});
      if(rest.includes('--live')&&!process.env.ANTHROPIC_API_KEY){console.log(JSON.stringify({error:'CREDENTIAL_MISSING'}));process.exit(2);}
      const plan=JSON.parse(fs.readFileSync(arg('--bundle'),'utf8')).plan;
      for(const [i,p] of plan.entries()){
        if(fs.existsSync(path.join(out,'CANCEL')))break;
        console.error((i+1)+'/'+plan.length+' '+p.id);
        fs.appendFileSync(path.join(out,'journal.jsonl'),JSON.stringify({kind:'episode',id:p.id,messages:['private'],complete:true})+'\n');
        await sleep(Number(process.env.FAKE_DELAY_MS||5));
      }
      fs.writeFileSync(path.join(out,'manifest.json'),JSON.stringify({status:'collection-closed',cancelled:fs.existsSync(path.join(out,'CANCEL'))}));
      fs.writeFileSync(path.join(out,'summary.json'),JSON.stringify({groups:[{language:'python'}],episodes:plan,collectionMode:rest.includes('--live')?'live':'offline-scripted'}));
      console.log(JSON.stringify({output:out,status:'complete'}));
    } else if(command==='analyze'){console.log(JSON.stringify({summary:'ok'}));}
  } else if(script.endsWith('joint_interpreter.py')){
    if(command==='prepare'){fs.writeFileSync(arg('--output'),'{}');console.log(JSON.stringify({status:'prepared',bundleDigest:'joint-digest',cases:2}));}
    else if(command==='run'){const out=arg('--output');fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'a.grade.json'),JSON.stringify({caseId:'a',boundaryStatus:'passed'}));await sleep(450);fs.writeFileSync(path.join(out,'report.json'),JSON.stringify({mode:arg('--mode'),language:arg('--language'),approved:rest.includes('--approved-digest')}));console.log(JSON.stringify({status:'ran'}));}
  } else if(script.endsWith('run-study.py')){
    const out=arg('--output');fs.mkdirSync(path.dirname(out),{recursive:true});
    if(rest.includes('--plan-only')){console.log(JSON.stringify({plan:'p',trials:3,planOnly:true}));return;}
    fs.writeFileSync(out.slice(0,-5)+'.journal.json',JSON.stringify({results:[{id:'t1',status:'observed',observation:{big:true}}]}));
    await sleep(450);
    fs.writeFileSync(out,JSON.stringify({status:'complete',results:[{id:'t1'}],groups:[],usage:{}}));
    console.log(JSON.stringify({report:out,exitCode:0}));
  } else {console.log(JSON.stringify({error:'UNKNOWN_SCRIPT',script}));process.exit(3);}
})();
`;

function fixture(){
  const data=mkdtempSync(join(tmpdir(),'psp-studio-py-'));
  const fake=join(data,'fake-engine.cjs');writeFileSync(fake,FAKE);
  const launcher=(script,args)=>[process.execPath,fake,script,...args];
  const vault=new Vault(join(data,'vault'));
  const services={vault,workspace:new Workspace(join(data,'ws')),repoRoot,uv:'uv'};
  const events=[],controller=new AbortController();
  const context=(dir=mkdtempSync(join(data,'run-')),extra={})=>({...services,runId:'r',artifactDir:dir,inspect:false,emit:e=>events.push(e),cancelled:()=>controller.signal.aborted,signal:controller.signal,...extra});
  return {data,launcher,services,events,controller,context,close:()=>rmSync(data,{recursive:true,force:true})};
}
const campaign={kind:'campaign',id:'camp',label:'Campaign',config:{roles:{attacker:{provider:'anthropic'}},caseIds:['read-attack','read-benign']},pairIds:['read','state']};

test('campaign engine prepares, runs, tails the journal and analyzes',async()=>{
  const f=fixture();
  try{
    const engine=new PythonEngine('campaign',f.launcher);
    const prepared=await engine.prepare(campaign,{...f.services,inspectAllowed:false});
    assert.equal(prepared.preview.episodes,4);assert.equal(prepared.admissionDigest,undefined);
    const result=await engine.run(campaign,f.context());
    assert.equal(result.status,'completed');assert.equal(result.summary.episodes,4);assert.equal(result.summary.collectionMode,'offline-scripted');
    const records=f.events.filter(e=>e.type==='campaign.record');
    assert.deepEqual(records.map(r=>r.data.id),['read-attack','read-benign','state-attack','state-benign']);
    assert.equal(records[0].data.messages,undefined,'raw transcript fields are stripped from the stream');
    assert.ok(f.events.some(e=>e.type==='studio.process.stderr'&&/1\/4 read-attack/.test(e.data.line)));
    assert.deepEqual(f.events.filter(e=>e.type==='studio.process.exit').map(e=>e.data.label),['campaign prepare','campaign run','campaign analyze']);
  }finally{f.close();}
});

test('live campaigns need admission and credentials from the vault',async()=>{
  const f=fixture();
  try{
    const engine=new PythonEngine('campaign',f.launcher);
    const live={...campaign,live:true};
    const prepared=await engine.prepare(live,{...f.services,inspectAllowed:false});
    assert.equal(prepared.admissionDigest,'digest-4');
    assert.ok(prepared.warnings.some(w=>/anthropic.apiKey/.test(w)));
    await assert.rejects(engine.run(live,f.context()),{code:'NOT_ADMITTED'});
    await assert.rejects(engine.run(live,f.context(undefined,{admissionDigest:'digest-4'})),e=>e.code==='PROCESS_FAILED'&&/CREDENTIAL_MISSING/.test(e.message));
    f.services.vault.set('anthropic.apiKey','synthetic');
    const result=await engine.run(live,f.context(undefined,{admissionDigest:'digest-4'}));
    assert.equal(result.summary.collectionMode,'live');
    assert.doesNotMatch(JSON.stringify(f.events),/synthetic/,'credentials never enter the event stream');
  }finally{f.close();}
});

test('cancelling a campaign drops the CANCEL file and the run ends as cancelled',async()=>{
  const f=fixture();
  try{
    process.env.FAKE_DELAY_MS='200';
    const engine=new PythonEngine('campaign',f.launcher);
    const dir=mkdtempSync(join(f.data,'run-'));
    const pending=engine.run(campaign,f.context(dir));
    await new Promise(r=>setTimeout(r,500));
    f.controller.abort();
    await assert.rejects(pending,{code:'CANCELLED'});
    assert.equal(existsSync(join(dir,'collection','CANCEL')),true);
    assert.ok(f.events.some(e=>e.type==='studio.process.cancel'&&e.data.graceful===true));
  }finally{delete process.env.FAKE_DELAY_MS;f.close();}
});

test('joint and study engines stream per-case files and journal rows; unsupported modes are explicit',async()=>{
  const f=fixture();
  try{
    const joint=new PythonEngine('joint',f.launcher);
    const scenario={kind:'joint',id:'j',label:'Joint',language:'typescript',mode:'rehearsal',caseIds:['a']};
    assert.equal((await joint.prepare(scenario,{...f.services,inspectAllowed:false})).preview.cases,2);
    const result=await joint.run(scenario,f.context());
    assert.equal(result.summary.report.language,'typescript');assert.equal(result.summary.report.approved,false);
    assert.ok(f.events.some(e=>e.type==='joint.grade'&&e.data.caseId==='a'));
    const study=new PythonEngine('study',f.launcher);
    const offline={kind:'study',id:'s',label:'Study',mode:'offline',hosts:['python'],peers:['typescript'],conditions:['combined'],repeats:1};
    await assert.rejects(study.run(offline,f.context()),{code:'UNSUPPORTED_DATA_DIR'});
    const inside=join(repoRoot,'.artifacts','studio-test',`run-${process.pid}-${Date.now()}`);mkdirSync(inside,{recursive:true});
    try{
      const studied=await study.run(offline,f.context(inside));
      assert.equal(studied.summary.trials,1);
      const row=f.events.find(e=>e.type==='study.result');
      assert.equal(row.data.id,'t1');assert.equal(row.data.observation,undefined);
    }finally{rmSync(join(repoRoot,'.artifacts','studio-test'),{recursive:true,force:true});}
    await assert.rejects(study.prepare({...offline,mode:'live'},{...f.services,inspectAllowed:false}),{code:'UNSUPPORTED_MODE'});
    const heldout=new PythonEngine('heldout',f.launcher);
    await assert.rejects(heldout.prepare({kind:'heldout',id:'h',label:'H',mode:'live',plan:'x',corpus:'y'},{...f.services,inspectAllowed:false}),{code:'UNSUPPORTED_MODE'});
    await assert.rejects(heldout.prepare({kind:'heldout',id:'h',label:'H',mode:'rehearsal',plan:'../outside.json',corpus:'y'},{...f.services,inspectAllowed:false}),{code:'INVALID_PATH'});
    await assert.rejects(heldout.prepare({kind:'heldout',id:'h',label:'H',mode:'rehearsal',plan:'conformance/missing.json',corpus:'y'},{...f.services,inspectAllowed:false}),{code:'NOT_FOUND'});
  }finally{f.close();}
});