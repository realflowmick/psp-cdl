// SPDX-License-Identifier: Apache-2.0
// The authoring assistant and PSPX endpoints against scripted provider streams. No network.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,mkdirSync,writeFileSync,readFileSync,readdirSync,copyFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createStudioServer} from '../dist/index.js';

const repoRoot=resolve(fileURLToPath(new URL('../../../',import.meta.url)));
const KEY='sk-ant-synthetic-key-5678';
const chunks=t=>t.match(/[\s\S]{1,40}/g)??[];
const anthropicSse=(text,stop='end_turn')=>[
  {type:'message_start',message:{usage:{input_tokens:120,output_tokens:1}}},
  ...chunks(text).map(t=>({type:'content_block_delta',index:0,delta:{type:'text_delta',text:t}})),
  {type:'message_delta',delta:{stop_reason:stop},usage:{output_tokens:60}},{type:'message_stop'}
].map(d=>`event: ${d.type}\ndata: ${JSON.stringify(d)}\n\n`).join('');
const openaiSse=(text,finish='stop')=>[
  ...chunks(text).map(t=>({choices:[{delta:{content:t},finish_reason:null}]})),{choices:[{delta:{},finish_reason:finish}]},{choices:[],usage:{prompt_tokens:80,completion_tokens:40}}
].map(d=>`data: ${JSON.stringify(d)}\n\n`).join('')+'data: [DONE]\n\n';
const reply=psp=>`Added a survey node.\n\n\`\`\`psp\n${psp}\n\`\`\``;

async function start(){
  const root=mkdtempSync(join(tmpdir(),'psp-assistant-'));
  const ws=join(root,'ws'),data=join(root,'data');mkdirSync(ws);
  copyFileSync(join(repoRoot,'examples/in-context/application.psp'),join(ws,'application.psp'));
  const calls=[],script=[];
  const fakeFetch=async(url,init)=>{
    calls.push({url,headers:init.headers,body:JSON.parse(init.body)});
    const next=script.shift();
    if(typeof next==='function')return next(init);
    return new Response(next,{status:200,headers:{'content-type':'text/event-stream'}});
  };
  const server=createStudioServer({workspace:ws,data,repoRoot,engines:["live-loop"],fetch:fakeFetch});
  const bound=await server.listen(0,'127.0.0.1');
  const api=async(path,init={})=>{const r=await fetch(`http://127.0.0.1:${bound.port}`+path,{...init,headers:{'content-type':'application/json'}});return {status:r.status,body:r.status===204?null:await r.json()};};
  const post=(path,body)=>api(path,{method:'POST',body:JSON.stringify(body)});
  const settle=async id=>{for(let i=0;i<400;i++){const r=await api(`/api/assistant/requests/${id}`);if(r.body.status!=='running')return r.body;await new Promise(r=>setTimeout(r,10));}throw new Error('request did not settle');};
  return {ws,calls,script,api,post,settle,close:async()=>{await server.close();rmSync(root,{recursive:true,force:true});}};
}
const original=()=>readFileSync(join(repoRoot,'examples/in-context/application.psp'),'utf8');
const revised=()=>original().replace('${psp type=transitions content-type=json}','${psp type=node node-type=prompt id="thanks" version="v1.0.0"}\n    ${psp type=system version="v1.0.0"}Thank the customer.${/psp}\n  ${/psp}\n  ${psp type=transitions content-type=json}').trim();
const b64=s=>Buffer.from(s).toString('base64');

test('a modification streams from the provider, records a jsondiffpatch delta, and is accepted',async()=>{
  const s=await start();
  try{
    let r=await s.api('/api/assistant/providers');
    assert.deepEqual(r.body.providers.map(p=>[p.id,p.configured]),[['anthropic',false],['openai',false]]);
    const request={mode:'modify',path:'application.psp',provider:'anthropic',model:'claude-opus-5-5',prompt:'Thank the customer at the end.',
      attachments:[{name:'notes.md',mediaType:'text/markdown',data:b64('# Requirements\nSay thanks.')},{name:'flow.png',mediaType:'image/png',data:b64('png-bytes')},{name:'spec.pdf',mediaType:'application/pdf',data:b64('%PDF-1.7')}]};
    r=await s.post('/api/assistant/requests',request);
    assert.equal(r.status,400);assert.equal(r.body.error.code,'KEY_MISSING');
    await s.api('/api/secrets/anthropic.apiKey',{method:'PUT',body:JSON.stringify({value:KEY})});
    s.script.push(anthropicSse(reply(revised())));
    r=await s.post('/api/assistant/requests',request);
    assert.equal(r.status,202);assert.equal(r.body.status,'running');assert.equal(r.body.before,original());
    const done=await s.settle(r.body.id);
    assert.equal(done.status,'proposed',JSON.stringify(done.error));
    assert.equal(done.summary,'Added a survey node.');
    assert.equal(done.proposal,revised()+'\n');
    assert.deepEqual(done.usage,{inputTokens:120,outputTokens:60});
    assert.ok(done.delta&&typeof done.delta==='object');
    assert.deepEqual(done.attachments.map(a=>[a.name,a.kind,a.bytes]),[['notes.md','text',26],['flow.png','image',9],['spec.pdf','pdf',8]]);
    const call=s.calls[0];
    assert.equal(call.url,'https://api.anthropic.com/v1/messages');assert.equal(call.headers['x-api-key'],KEY);assert.equal(call.body.stream,true);
    assert.match(call.body.system,/PSP application author/);
    const content=call.body.messages[0].content;
    assert.deepEqual(content.map(c=>c.type),['text','image','document','text']);
    assert.match(content[0].text,/<attachment name="notes.md">\n# Requirements/);assert.equal(content[1].source.data,b64('png-bytes'));
    assert.match(content[3].text,/Revise the PSP application in application.psp[\s\S]*Current application:\n```psp\n\$\{psp type=node node-type=application/);
    // History lives beside the workspace, holds no key and no attachment content.
    const stored=readdirSync(join(s.ws,'.studio','assistant'));assert.deepEqual(stored,[`${done.id}.json`]);
    const raw=readFileSync(join(s.ws,'.studio','assistant',stored[0]),'utf8');
    assert.doesNotMatch(raw,new RegExp(KEY));assert.doesNotMatch(raw,new RegExp(b64('png-bytes')));
    r=await s.api('/api/assistant/requests?path=application.psp');
    assert.deepEqual(r.body.requests.map(x=>[x.id,x.status]),[[done.id,'proposed']]);assert.equal(r.body.requests[0].proposal,undefined);
    r=await s.post(`/api/assistant/requests/${done.id}/accept`,{});
    assert.equal(r.body.status,'accepted');
    assert.equal(readFileSync(join(s.ws,'application.psp'),'utf8'),revised()+'\n');
    r=await s.post(`/api/assistant/requests/${done.id}/accept`,{});assert.equal(r.status,409);
  }finally{await s.close();}
});

test('a reply that does not parse is sent back once for repair; OpenAI streams create a .pspx',async()=>{
  const s=await start();
  try{
    await s.api('/api/secrets/openai.apiKey',{method:'PUT',body:JSON.stringify({value:'sk-openai-synthetic-0000'})});
    const app='${psp type=node node-type=application name="intake" session-id="dev" version="v1.0.0"}\n  ${psp type=node node-type=prompt id="ask" version="v1.0.0"}\n    ${psp type=system version="v1.0.0"}Ask.${/psp}\n  ${/psp}\n${/psp}';
    s.script.push(openaiSse(reply('${psp type=node node-type=application name="intake"}')),openaiSse(reply(app)));
    let r=await s.post('/api/assistant/requests',{mode:'create',path:'intake.pspx',provider:'openai',model:'gpt-5',prompt:'An intake form.'});
    const done=await s.settle(r.body.id);
    assert.equal(done.status,'proposed',JSON.stringify(done.error));assert.equal(done.attempts,2);assert.equal(done.format,'pspx');assert.equal(done.before,null);
    assert.equal(s.calls[0].url,'https://api.openai.com/v1/chat/completions');assert.equal(s.calls[0].headers.authorization,'Bearer sk-openai-synthetic-0000');
    assert.equal(s.calls[0].body.messages[0].role,'system');assert.match(s.calls[0].body.messages[1].content[0].text,/Create a complete PSP application for the file intake.pspx/);
    assert.match(s.calls[1].body.messages[3].content[0].text,/did not parse \(UNCLOSED_SECTION/);
    r=await s.post(`/api/assistant/requests/${done.id}/accept`,{});assert.equal(r.body.status,'accepted');
    const written=readFileSync(join(s.ws,'intake.pspx'),'utf8');
    assert.match(written,/^<!-- PSPX\/0\.1 \{"profile":"PSPX-0.1","interpreter":"psp-core-3.2-draft-0.1","application":"intake.psp"/);
    r=await s.post('/api/pspx/unpack',{text:written});
    assert.equal(r.body.application,app+'\n');assert.deepEqual(r.body.verified,{system:true,application:true});
    assert.match(r.body.system,/^# PSP Core 3\.2\.0 interpreter candidate 0\.1/);assert.match(r.body.system,/# CDL 1\.5 interpreter candidate 0\.1/);
    r=await s.api('/api/workspace/files');assert.ok(r.body.files.some(f=>f.path==='intake.pspx'));assert.ok(!r.body.files.some(f=>f.path.startsWith('.studio')));
  }finally{await s.close();}
});

test('accepting checks the file did not change; reject, cancel, truncation and key rejection are recorded',async()=>{
  const s=await start();
  try{
    await s.api('/api/secrets/anthropic.apiKey',{method:'PUT',body:JSON.stringify({value:KEY})});
    const base={mode:'modify',path:'application.psp',provider:'anthropic',model:'claude-sonnet-5-5',prompt:'Change it.'};
    s.script.push(anthropicSse(reply(revised())));
    let r=await s.post('/api/assistant/requests',base);const first=await s.settle(r.body.id);
    writeFileSync(join(s.ws,'application.psp'),original()+'\n<!-- edited by hand -->\n');
    r=await s.post(`/api/assistant/requests/${first.id}/accept`,{});assert.equal(r.status,409);assert.equal(r.body.error.code,'FILE_CHANGED');
    r=await s.post(`/api/assistant/requests/${first.id}/accept`,{force:true});assert.equal(r.body.status,'accepted');
    s.script.push(anthropicSse(reply(revised())));
    r=await s.post('/api/assistant/requests',{...base,baseId:first.id});const refined=await s.settle(r.body.id);
    assert.match(s.calls.at(-1).body.messages[0].content[0].text,/id="thanks"/);
    r=await s.post(`/api/assistant/requests/${refined.id}/reject`);assert.equal(r.body.status,'rejected');
    s.script.push(init=>new Promise((_,reject)=>init.signal.addEventListener('abort',()=>reject(new DOMException('aborted','AbortError')))));
    r=await s.post('/api/assistant/requests',base);const id=r.body.id;
    r=await s.post(`/api/assistant/requests/${id}/cancel`);assert.equal(r.status,200);
    assert.equal((await s.settle(id)).status,'cancelled');
    s.script.push(anthropicSse('```psp\n${psp type=node','max_tokens'));
    r=await s.post('/api/assistant/requests',base);let failed=await s.settle(r.body.id);
    assert.deepEqual([failed.status,failed.error.code],['failed','RESPONSE_TRUNCATED']);
    s.script.push(()=>new Response(JSON.stringify({error:{type:'authentication_error',message:'invalid x-api-key'}}),{status:401}));
    r=await s.post('/api/assistant/requests',base);failed=await s.settle(r.body.id);
    assert.deepEqual([failed.status,failed.error.code],['failed','KEY_REJECTED']);assert.match(failed.error.message,/HTTP 401: invalid x-api-key/);
    r=await s.post('/api/assistant/requests',{...base,mode:'create'});assert.equal(r.body.error.code,'FILE_EXISTS');
    r=await s.post('/api/assistant/requests',{...base,attachments:[{name:'x.exe',mediaType:'application/octet-stream',data:b64('MZ')}]});assert.equal(r.body.error.code,'UNSUPPORTED_ATTACHMENT');
    // Larger than the default 4 MiB body limit, within the assistant route's limit and the per-file cap.
    s.script.push(anthropicSse(reply(revised())));
    r=await s.post('/api/assistant/requests',{...base,attachments:[{name:'big.png',mediaType:'image/png',data:Buffer.alloc(6*1024*1024,1).toString('base64')}]});
    assert.equal(r.status,202);await s.settle(r.body.id);
    r=await s.post('/api/assistant/requests',{...base,attachments:[{name:'huge.png',mediaType:'image/png',data:Buffer.alloc(11*1024*1024,1).toString('base64')}]});
    assert.equal(r.body.error.code,'ATTACHMENT_TOO_LARGE');
    r=await s.api('/api/assistant/requests');assert.deepEqual(r.body.requests.map(x=>x.status).sort(),['accepted','cancelled','failed','failed','proposed','rejected']);
  }finally{await s.close();}
});

test('PSPX pack keeps a given system prompt and unpack flags edits',async()=>{
  const s=await start();
  try{
    let r=await s.api('/api/pspx/interpreters');assert.deepEqual(r.body.interpreters.map(i=>[i.id,i.available]),[['psp-core-3.2-draft-0.1',true]]);
    r=await s.post('/api/pspx/pack',{application:'${psp type=node id="a" version="1" /}\r\n',name:'dir/a.psp',system:'Custom system prompt.'});
    assert.equal(r.body.manifest.interpreter,'custom');assert.equal(r.body.manifest.application,'a.psp');
    assert.match(r.body.text,/\n<!-- pspx:system -->\nCustom system prompt\.\n<!-- pspx:application -->\n\$\{psp type=node id="a" version="1" \/\}\n$/);
    const tampered=r.body.text.replace('Custom system','Edited system');
    r=await s.post('/api/pspx/unpack',{text:tampered});
    assert.deepEqual(r.body.verified,{system:false,application:true});assert.match(r.body.warnings[0],/system prompt differs/);assert.match(r.body.warnings[1],/custom is not one this studio ships/);
    r=await s.post('/api/pspx/unpack',{text:'${psp type=node /}'});assert.equal(r.body.error.code,'NOT_PSPX');
    r=await s.post('/api/pspx/pack',{application:'x',name:'a.psp',system:'line\n<!-- pspx:application -->\nmore'});assert.equal(r.body.error.code,'INVALID_SYSTEM');
  }finally{await s.close();}
});
