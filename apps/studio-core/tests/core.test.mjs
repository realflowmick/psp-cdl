// SPDX-License-Identifier: Apache-2.0
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import Ajv from 'ajv';
import {STUDIO_PROFILE,ENGINE_KINDS,classifyObserverEvent,isTerminal,isIdentifier,defaultCollection,defaultLiveLoopScenario} from '../dist/index.js';

const schema=JSON.parse(readFileSync(new URL('../schemas/scenario-collection.schema.json',import.meta.url),'utf8'));
const validate=new Ajv({strict:true,allErrors:true,formats:{'date-time':v=>!Number.isNaN(Date.parse(v))}}).compile(schema);

test('profile and engine kinds are stable',()=>{
  assert.equal(STUDIO_PROFILE,'PSP-STUDIO-0.1');
  assert.deepEqual([...ENGINE_KINDS],['live-loop','campaign','joint','study','heldout']);
});

test('the starter collection validates against the shared schema',()=>{
  const collection=defaultCollection();
  assert.equal(validate(collection),true,JSON.stringify(validate.errors));
  assert.equal(new Set(collection.scenarios.map(s=>s.id)).size,collection.scenarios.length);
});

test('the schema rejects unknown fields, bad identifiers and unsupported loops',()=>{
  const bad=[
    {...defaultCollection(),extra:true},
    {...defaultCollection(),id:'has space'},
    {...defaultCollection(),scenarios:[{...defaultLiveLoopScenario(),loop:'streaming'}]},
    {...defaultCollection(),scenarios:[{...defaultLiveLoopScenario(),node:{nodeId:'review',nodeVersion:'v1.0.0',agents:['http://echo/read']}}]},
    {...defaultCollection(),scenarios:[{kind:'campaign',id:'c',label:'c'}]}
  ];
  for(const value of bad)assert.equal(validate(value),false);
});

test('identifier and terminal helpers',()=>{
  assert.equal(isIdentifier('durable-echo'),true);
  assert.equal(isIdentifier('-leading'),false);
  assert.equal(isIdentifier('x'.repeat(65)),false);
  assert.equal(isTerminal('completed'),true);
  assert.equal(isTerminal('running'),false);
});

test('observer severities colour denials and failures without changing data',()=>{
  assert.equal(classifyObserverEvent('cdl.decision',{decision:'allow'}),'info');
  assert.equal(classifyObserverEvent('cdl.decision',{decision:'deny'}),'error');
  assert.equal(classifyObserverEvent('turn.failed',{code:'POLICY_DENIED'}),'error');
  assert.equal(classifyObserverEvent('lockdown',{}),'error');
  assert.equal(classifyObserverEvent('inference.end',{ok:false}),'error');
  assert.equal(classifyObserverEvent('inference.end',{ok:true}),'info');
  assert.equal(classifyObserverEvent('service.result',{event:'service-denied'}),'warn');
  assert.equal(classifyObserverEvent('refresh.due',{trigger:'interval'}),'warn');
  assert.equal(classifyObserverEvent('turn.committed',{}),'success');
  assert.equal(classifyObserverEvent('prompt.loaded',{}),'info');
});

test('PSPX puts the system prompt first and parses back exactly',async()=>{
  const {formatPspx,parsePspx,isPspxText,PSPX_PROFILE}=await import('../dist/index.js');
  const manifest={profile:PSPX_PROFILE,interpreter:'custom',application:'a-->b.psp',exportedAt:'2026-10-12T00:00:00.000Z',systemSha256:'s',applicationSha256:'a'};
  const text=formatPspx(manifest,'System line.\n','${psp type=node id="a" version="1" /}\n');
  assert.ok(isPspxText(text));
  assert.ok(text.split('\n')[0].endsWith(' -->'));
  assert.ok(!text.split('\n')[0].slice(0,-4).includes('-->'));
  assert.deepEqual(parsePspx(text),{manifest,system:'System line.\n',application:'${psp type=node id="a" version="1" /}\n'});
  assert.deepEqual(parsePspx(text.replace(/\n/g,'\r\n')).system,'System line.\n');
  assert.equal(parsePspx(formatPspx(manifest,'','x')).system,'');
  assert.throws(()=>parsePspx('plain text'),{code:'NOT_PSPX'});
  assert.throws(()=>parsePspx(text.replace('<!-- pspx:application -->','')),{code:'MISSING_APPLICATION'});
  assert.throws(()=>parsePspx(text.replace('PSPX/0.1','PSPX/9.0')),{code:'UNSUPPORTED_VERSION'});
});
