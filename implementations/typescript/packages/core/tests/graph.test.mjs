// SPDX-License-Identifier: Apache-2.0
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {compileApplication,parseMarkup,serializeMarkup} from '../dist/index.js';
const cases=JSON.parse(readFileSync(new URL('../../../../../conformance/vectors/graphs/profile-0.1.json',import.meta.url),'utf8')).cases;
for(const c of cases)test('graph: '+c.id,()=>{
  const run=()=>{const g=compileApplication(c.request),result={description:g.describe()};if(c.select)result.selection=g.select(...c.select);return result;};
  if(c.expected.error)assert.throws(run,e=>e.code===c.expected.error);
  else assert.deepEqual(run(),c.expected.result);
});
test('graph authority survives mutation and markup roundtrip',()=>{
  const q=structuredClone(cases[0].request);
  q.document=parseMarkup(serializeMarkup(q.document));
  const g=compileApplication(q),d=g.describe();
  assert.deepEqual(d,cases[0].expected.result.description);
  q.document.children.length=0;d.nodes[1].transitions.length=0;
  assert.deepEqual(g.select('/left',true,{}),cases[0].expected.result.selection);
  assert.deepEqual(g.describe(),cases[0].expected.result.description);
});
test('graph objects do not execute accessors',()=>{
  const q=structuredClone(cases[0].request);let calls=0;
  Object.defineProperty(q,'document',{get(){calls++;throw Error('executed');},enumerable:true});
  assert.throws(()=>compileApplication(q),e=>e.code==='INVALID_JSON_VALUE');assert.equal(calls,0);
});
test('graph bounds node count and depth',()=>{
  const q=structuredClone(cases[0].request),r=q.document.children[0],leaf=structuredClone(r.children[1]);
  r.children=Array.from({length:1024},(_,i)=>({...structuredClone(leaf),attributes:{...leaf.attributes,id:'n'+i}}));
  assert.throws(()=>compileApplication(q),e=>e.code==='GRAPH_LIMIT_EXCEEDED');
  r.children=[structuredClone(leaf)];let n=r.children[0];
  for(let i=0;i<32;i++){n.attributes['node-type']='composite';n.children=[structuredClone(leaf)];n=n.children[0];}
  assert.throws(()=>compileApplication(q),e=>e.code==='GRAPH_LIMIT_EXCEEDED');
});

test('accepted graph requests and results satisfy shared schemas', async()=>{
  const {default:Ajv2020}=await import('ajv/dist/2020.js');
  const schema=JSON.parse(readFileSync(new URL('../../../../../schemas/application-graph-0.1.schema.json',import.meta.url),'utf8'));
  const ajv=new Ajv2020({allErrors:true}),request=ajv.compile(schema),description=ajv.compile({$ref:schema.$id+'#/$defs/description'}),selection=ajv.compile({$ref:schema.$id+'#/$defs/selection'});
  for(const c of cases.filter(c=>c.expected.result)){
    assert(request(c.request),JSON.stringify(request.errors));
    const g=compileApplication(c.request);assert(description(g.describe()),JSON.stringify(description.errors));
    if(c.select)assert(selection(g.select(...c.select)),JSON.stringify(selection.errors));
  }
});
