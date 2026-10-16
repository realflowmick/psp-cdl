// SPDX-License-Identifier: Apache-2.0
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,rmSync,writeFileSync,existsSync,readdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {defaultCollection,defaultLiveLoopScenario} from '@psp-cdl/studio-core';
import {Workspace,CollectionStore} from '../dist/index.js';

test('workspace lists, reads and writes files inside its root only',()=>{
  const root=mkdtempSync(join(tmpdir(),'psp-studio-ws-'));
  try{
    mkdirSync(join(root,'nested','node_modules'),{recursive:true});
    writeFileSync(join(root,'application.psp'),'${psp type=node}x${/psp}');
    writeFileSync(join(root,'nested','notes.md'),'# notes');
    writeFileSync(join(root,'nested','node_modules','skip.psp'),'skip');
    writeFileSync(join(root,'binary.bin'),'nope');
    const ws=new Workspace(root);
    assert.deepEqual(ws.list().map(f=>f.path),['application.psp','nested/notes.md']);
    assert.equal(ws.read('application.psp').text,'${psp type=node}x${/psp}');
    const written=ws.write('nested/new.psp','${psp type=node}y${/psp}');
    assert.equal(written.bytes,24);
    assert.equal(ws.read('nested/new.psp').text,'${psp type=node}y${/psp}');
    assert.equal(readdirSync(join(root,'nested')).some(n=>n.endsWith('.tmp')),false);
    for(const bad of ['../escape.psp','a/../../escape.psp','C:/x.psp','nested\\x.psp','','con.psp','binary.bin','/abs.psp'])assert.throws(()=>ws.resolve(bad),e=>['INVALID_PATH','UNSUPPORTED_FILE'].includes(e.code),bad);
    assert.throws(()=>ws.read('missing.psp'),{code:'NOT_FOUND'});
    assert.throws(()=>ws.write('x.psp','bad\u0000char'),{code:'INVALID_CONTENT'});
    assert.throws(()=>ws.write('x.psp','x'.repeat(1_048_577)),{code:'INVALID_CONTENT'});
    assert.equal(existsSync(join(root,'..','escape.psp')),false);
  }finally{rmSync(root,{recursive:true,force:true});}
});

test('collection store seeds the starter set, validates writes and rejects cross-field errors',()=>{
  const data=mkdtempSync(join(tmpdir(),'psp-studio-data-'));
  try{
    const store=new CollectionStore(data);
    const seeded=store.list();
    assert.equal(seeded.length,1);assert.equal(seeded[0].id,'starter');
    assert.equal(store.scenario('starter','durable-echo').kind,'live-loop');
    assert.throws(()=>store.scenario('starter','missing'),{code:'NOT_FOUND'});
    const good={...defaultCollection('second'),scenarios:[defaultLiveLoopScenario('one')]};
    const stored=store.put(good);
    assert.equal(stored.id,'second');assert.equal(store.list().length,2);
    assert.throws(()=>store.put({...good,extra:1}),{code:'INVALID_COLLECTION'});
    assert.throws(()=>store.put({...good,scenarios:[defaultLiveLoopScenario('dup'),defaultLiveLoopScenario('dup')]}),/Duplicate scenario id/);
    const unknownTool={...defaultLiveLoopScenario('t'),provider:{kind:'mock',script:[[{type:'tool',name:'other.read',arguments:{}}]]}};
    assert.throws(()=>store.put({...good,scenarios:[unknownTool]}),/unknown tool other.read/);
    assert.throws(()=>store.put({...good,scenarios:[{...defaultLiveLoopScenario('r'),loop:'refreshing'}]}),/without a refresh block/);
    assert.throws(()=>store.put({...good,scenarios:[{...defaultLiveLoopScenario('r'),loop:'refreshing',refresh:{policy:'expiration',interval:2,ttl:60}}]}),/interval/);
    assert.throws(()=>store.put({...good,scenarios:[{...defaultLiveLoopScenario('c'),plan:{statePolicy:'accumulate',completeOnTurn:9}}]}),/completeOnTurn/);
    const campaign={kind:'campaign',id:'camp',label:'Campaign',config:{profile:'PSP-CAMPAIGN-0.1'},pairIds:['read'],live:false};
    store.put({...good,id:'third',scenarios:[campaign]});
    assert.equal(store.get('third').scenarios[0].kind,'campaign');
    store.delete('third');
    assert.throws(()=>store.get('third'),{code:'NOT_FOUND'});
    assert.throws(()=>store.delete('third'),{code:'NOT_FOUND'});
    assert.throws(()=>store.get('../x'),{code:'INVALID_IDENTIFIER'});
  }finally{rmSync(data,{recursive:true,force:true});}
});
