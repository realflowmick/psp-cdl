// SPDX-License-Identifier: Apache-2.0
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {RunManager} from '../dist/index.js';

const input={engine:'live-loop',scenarioId:'s',collectionId:'c',label:'Run',inspect:false};

test('run manager journals events with increasing seq and reports every outcome',async()=>{
  const data=mkdtempSync(join(tmpdir(),'psp-studio-runs-'));
  try{
    const runs=new RunManager(data);
    const live=[],statuses=[];
    runs.onEvent(e=>live.push(e));runs.onStatus(r=>statuses.push(r.status));
    const record=runs.create(input);
    assert.equal(record.status,'queued');
    const done=await runs.execute(record.runId,async handle=>{
      handle.emit({source:'llmproxy',type:'turn.start',severity:'info',data:{a:1}});
      handle.emit({source:'studio',type:'studio.turn.end',severity:'success',turn:1,data:{code:'OK'}});
      return {status:'completed',summary:{turns:1}};
    });
    assert.equal(done.status,'completed');assert.deepEqual(done.summary,{turns:1});assert.ok(done.finishedAt);
    const events=runs.events(record.runId);
    assert.deepEqual(events.map(e=>[e.seq,e.type]),[[1,'studio.run.status'],[2,'turn.start'],[3,'studio.turn.end'],[4,'studio.run.status']]);
    assert.deepEqual(runs.events(record.runId,3).map(e=>e.seq),[3,4]);
    assert.equal(live.length,4);assert.equal(events[1].engine,'live-loop');assert.equal(events[1].runId,record.runId);
    assert.deepEqual(statuses,['running','completed']);
    assert.equal(readFileSync(join(record.artifactDir,'events.jsonl'),'utf8').trim().split('\n').length,4);
    assert.equal(JSON.parse(readFileSync(join(record.artifactDir,'run.json'),'utf8')).lastSeq,4);
    await assert.rejects(runs.execute(record.runId,async()=>({status:'completed',summary:{}})),{code:'INVALID_STATE'});

    const failing=runs.create(input);
    const failed=await runs.execute(failing.runId,async()=>{throw Object.assign(new Error('boom'),{code:'ENGINE_BROKE'});});
    assert.equal(failed.status,'failed');assert.deepEqual(failed.error,{code:'ENGINE_BROKE',message:'boom'});
    assert.equal(runs.list()[0].runId,failing.runId);
  }finally{rmSync(data,{recursive:true,force:true});}
});

test('cancel aborts a running executor and closes a queued run',async()=>{
  const data=mkdtempSync(join(tmpdir(),'psp-studio-runs-'));
  try{
    const runs=new RunManager(data);
    const record=runs.create(input);
    let seen;
    const pending=runs.execute(record.runId,handle=>new Promise(resolve=>{
      const timer=setInterval(()=>{if(handle.cancelled()){clearInterval(timer);seen=handle.signal.aborted;resolve({status:'completed',summary:{ignored:true}});}},5);
    }));
    await new Promise(r=>setTimeout(r,20));
    assert.equal(runs.cancel(record.runId).status,'cancelling');
    const done=await pending;
    assert.equal(seen,true);assert.equal(done.status,'cancelled');
    assert.equal(runs.events(record.runId).at(-1).data.status,'cancelled');
    const queued=runs.create(input);
    assert.equal(runs.cancel(queued.runId).status,'cancelled');
    assert.equal(runs.cancel(queued.runId).status,'cancelled');
    assert.equal(runs.active(),0);
  }finally{rmSync(data,{recursive:true,force:true});}
});

test('a restart marks runs that were active as interrupted',()=>{
  const data=mkdtempSync(join(tmpdir(),'psp-studio-runs-'));
  try{
    const dir=join(data,'runs','20260101T000000Z-abc123');mkdirSync(dir,{recursive:true});
    writeFileSync(join(dir,'run.json'),JSON.stringify({runId:'20260101T000000Z-abc123',scenarioId:'s',engine:'campaign',label:'x',status:'running',startedAt:'2026-01-01T00:00:00Z',lastSeq:2,inspect:false,artifactDir:dir}));
    const runs=new RunManager(data);
    const record=runs.get('20260101T000000Z-abc123');
    assert.equal(record.status,'failed');assert.equal(record.error.code,'INTERRUPTED');
    assert.equal(JSON.parse(readFileSync(join(dir,'run.json'),'utf8')).status,'failed');
    assert.throws(()=>runs.get('missing'),{code:'NOT_FOUND'});
  }finally{rmSync(data,{recursive:true,force:true});}
});
