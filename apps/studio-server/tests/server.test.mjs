// SPDX-License-Identifier: Apache-2.0
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,mkdirSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {io} from 'socket.io-client';
import {createStudioServer,SOCKET_PATH} from '../dist/index.js';

const repoRoot=resolve(fileURLToPath(new URL('../../../',import.meta.url)));
async function start(options={}){
  const data=mkdtempSync(join(tmpdir(),'psp-studio-server-'));
  const server=createStudioServer({workspace:join(repoRoot,'examples','in-context'),data,repoRoot,engines:['live-loop'],...options});
  const bound=await server.listen(0,'127.0.0.1');
  const base=`http://127.0.0.1:${bound.port}`;
  const api=async(path,init={})=>{const r=await fetch(base+path,{...init,headers:{'content-type':'application/json',...(init.headers??{})}});return {status:r.status,body:r.status===204?null:await r.json()};};
  return {server,base,api,close:async()=>{await server.close();rmSync(data,{recursive:true,force:true});}};
}
const wait=async(api,runId)=>{for(let i=0;i<400;i++){const {body}=await api(`/api/runs/${runId}`);if(['completed','failed','cancelled'].includes(body.status))return body;await new Promise(r=>setTimeout(r,25));}throw new Error('run did not finish');};

test('HTTP API exposes status, collections, workspace, secrets and runs',async()=>{
  const s=await start();
  try{
    let r=await s.api('/api/status');
    assert.equal(r.body.profile,'PSP-STUDIO-0.1');assert.deepEqual(r.body.engines,['live-loop']);assert.equal(r.body.inspectAllowed,false);
    r=await s.api('/api/templates');assert.equal(r.body.campaignConfig.profile,'PSP-CAMPAIGN-0.1');assert.ok(r.body.jointCaseIds.includes('natural-language'));assert.deepEqual(r.body.languages,['typescript','python']);
    r=await s.api('/api/collections');assert.equal(r.body.collections[0].id,'starter');
    r=await s.api('/api/collections/starter',{method:'PUT',body:JSON.stringify({...r.body.collections[0],id:'other'})});assert.equal(r.status,400);
    r=await s.api('/api/collections/starter',{method:'PUT',body:JSON.stringify({id:'starter'})});assert.equal(r.status,400);assert.equal(r.body.error.code,'INVALID_COLLECTION');
    r=await s.api('/api/workspace/files');assert.ok(r.body.files.some(f=>f.path==='application.psp'));
    r=await s.api('/api/workspace/files/application.psp');assert.match(r.body.text,/node-type=application/);
    r=await s.api('/api/workspace/files/nested%5C..%5Cescape.psp');assert.equal(r.status,400);assert.equal(r.body.error.code,'INVALID_PATH');
    r=await s.api('/api/secrets');assert.equal(r.body.signing.configured,false);
    r=await s.api('/api/secrets/openai.apiKey',{method:'PUT',body:JSON.stringify({value:'sk-synthetic-value-1234'})});assert.equal(r.body.hint,'…1234');
    r=await s.api('/api/secrets');assert.doesNotMatch(JSON.stringify(r.body),/sk-synthetic/);
    r=await s.api('/api/secrets/signing/generate',{method:'POST',body:JSON.stringify({algorithm:'hmac-sha256',keyId:'k1'})});assert.equal(r.body.keyId,'k1');
    r=await s.api('/api/secrets/openai.apiKey',{method:'DELETE'});assert.equal(r.status,204);
    r=await s.api('/api/runs/prepare',{method:'POST',body:JSON.stringify({collectionId:'starter',scenarioId:'durable-echo'})});
    assert.equal(r.status,200);assert.equal(r.body.preview.signing.source,'vault');
    r=await s.api('/api/runs',{method:'POST',body:JSON.stringify({collectionId:'starter',scenarioId:'durable-echo',inspect:true})});assert.equal(r.status,403);
    r=await s.api('/api/runs',{method:'POST',body:JSON.stringify({collectionId:'starter',scenarioId:'buffered-echo'})});
    assert.equal(r.status,202);assert.equal(r.body.engine,'live-loop');
    const done=await wait(s.api,r.body.runId);
    assert.equal(done.status,'completed');assert.deepEqual(done.summary.turns.map(t=>t.code),['OK']);
    r=await s.api(`/api/runs/${done.runId}/events?from=2&limit=3`);assert.deepEqual(r.body.events.map(e=>e.seq),[2,3,4]);assert.equal(r.body.next,5);
    r=await s.api('/api/runs');assert.equal(r.body.runs[0].runId,done.runId);
    r=await s.api('/api/runs',{method:'POST',body:JSON.stringify({collectionId:'starter',scenarioId:'nope'})});assert.equal(r.status,404);
  }finally{await s.close();}
});

test('socket hub replays a journal from a sequence and streams live events',async()=>{
  const s=await start({inspect:true});
  let client;
  try{
    const first=(await s.api('/api/runs',{method:'POST',body:JSON.stringify({collectionId:'starter',scenarioId:'lockdown-demo',inspect:true})})).body;
    await wait(s.api,first.runId);
    client=io(s.base,{path:SOCKET_PATH,transports:['websocket']});
    const received=[];let replay=[];
    client.on('event',e=>received.push(e));
    client.on('replay',r=>{replay=replay.concat(r.events);});
    await new Promise((resolve,reject)=>{client.on('connect',resolve);client.on('connect_error',reject);});
    const ack=await new Promise(resolve=>client.emit('subscribe',{runId:first.runId,fromSeq:3},resolve));
    assert.equal(ack.run.status,'completed');assert.equal(ack.replayed,replay.length);
    await new Promise(r=>setTimeout(r,50));
    assert.equal(replay[0].seq,3);assert.equal(replay.at(-1).type,'studio.run.status');
    assert.ok(replay.some(e=>e.type==='lockdown'));
    assert.ok(replay.some(e=>e.type==='prompt.loaded'&&e.data.payload));
    const missing=await new Promise(resolve=>client.emit('subscribe',{runId:'nope'},resolve));
    assert.equal(missing.error.code,'NOT_FOUND');
    const statuses=[];client.on('run',r=>statuses.push(r.status));
    replay=[];
    const second=(await s.api('/api/runs',{method:'POST',body:JSON.stringify({collectionId:'starter',scenarioId:'durable-echo'})})).body;
    client.emit('subscribe',{runId:second.runId,fromSeq:1});
    await wait(s.api,second.runId);
    await new Promise(r=>setTimeout(r,100));
    // A client merges the replay with live events and de-duplicates by seq.
    const merged=new Map([...replay,...received].filter(e=>e.runId===second.runId).map(e=>[e.seq,e]));
    const live=[...merged.keys()].sort((a,b)=>a-b).map(k=>merged.get(k));
    assert.deepEqual(live.map(e=>e.seq),live.map((_,i)=>i+1),'no gaps or duplicates');
    assert.ok(live.some(e=>e.type==='turn.committed'));
    assert.equal(live.at(-1).data.status,'completed');
    assert.ok(statuses.includes('running')&&statuses.includes('completed'));
  }finally{client?.close();await s.close();}
});


test('a built web bundle is served beside the API with index fallback and no traversal',async()=>{
  const web=mkdtempSync(join(tmpdir(),'psp-studio-web-'));
  mkdirSync(join(web,'assets'));
  writeFileSync(join(web,'index.html'),'<!doctype html><title>PSP Studio</title>');
  writeFileSync(join(web,'assets','app.js'),'console.log(1)');
  const s=await start({web});
  try{
    let r=await fetch(`${s.base}/`);assert.equal(r.status,200);assert.match(r.headers.get('content-type'),/text\/html/);assert.match(await r.text(),/PSP Studio/);
    r=await fetch(`${s.base}/assets/app.js`);assert.equal(r.status,200);assert.match(r.headers.get('content-type'),/javascript/);
    r=await fetch(`${s.base}/runs/some-client-route`);assert.equal(r.status,200);assert.match(await r.text(),/PSP Studio/);
    r=await fetch(`${s.base}/assets/..%2F..%2Fpackage.json`);assert.equal(r.status,200);assert.match(await r.text(),/PSP Studio/,'traversal falls back to the app shell');
    r=await fetch(`${s.base}/api/status`);assert.equal((await r.json()).profile,'PSP-STUDIO-0.1');
  }finally{await s.close();rmSync(web,{recursive:true,force:true});}
});