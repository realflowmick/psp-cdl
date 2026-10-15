// SPDX-License-Identifier: Apache-2.0
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtempSync,rmSync,readFileSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Router,Reply,StudioError,Vault,MAX_BODY_BYTES} from '../dist/index.js';

async function serve(router){
  const server=createServer((req,res)=>{void router.handle(req,res);});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const base=`http://127.0.0.1:${server.address().port}`;
  return {base,close:()=>new Promise(r=>server.close(r))};
}

test('router matches methods, params and wildcards, and bounds bodies',async()=>{
  const router=new Router(['http://allowed.test'])
    .add('GET','/api/items/:id',ctx=>({id:ctx.params.id,q:ctx.query.get('q')}))
    .add('PUT','/api/items/:id',ctx=>new Reply(201,{body:ctx.body}))
    .add('GET','/api/files/*path',ctx=>({path:ctx.params.path}))
    .add('GET','/api/fail',()=>{throw new StudioError('TEAPOT',418,'short and stout');})
    .add('GET','/api/crash',()=>{throw new Error('PRIVATE_DETAIL');})
    .add('DELETE','/api/items/:id',()=>undefined);
  const {base,close}=await serve(router);
  try{
    let r=await fetch(`${base}/api/items/a%20b?q=1`);assert.equal(r.status,200);assert.deepEqual(await r.json(),{id:'a b',q:'1'});
    r=await fetch(`${base}/api/files/dir/sub/file.psp`);assert.deepEqual(await r.json(),{path:'dir/sub/file.psp'});
    r=await fetch(`${base}/api/items/x`,{method:'PUT',body:JSON.stringify({v:1}),headers:{'content-type':'application/json'}});assert.equal(r.status,201);assert.deepEqual(await r.json(),{body:{v:1}});
    r=await fetch(`${base}/api/items/x`,{method:'PUT',body:'{not json'});assert.equal(r.status,400);assert.equal((await r.json()).error.code,'INVALID_JSON');
    r=await fetch(`${base}/api/items/x`,{method:'DELETE'});assert.equal(r.status,204);
    r=await fetch(`${base}/api/items/x`,{method:'PATCH'});assert.equal(r.status,405);
    r=await fetch(`${base}/nope`);assert.equal(r.status,404);
    r=await fetch(`${base}/api/fail`);assert.equal(r.status,418);assert.deepEqual(await r.json(),{error:{code:'TEAPOT',message:'short and stout'}});
    r=await fetch(`${base}/api/crash`);assert.equal(r.status,500);const crash=await r.json();assert.equal(crash.error.code,'INTERNAL_ERROR');assert.doesNotMatch(JSON.stringify(crash),/PRIVATE_DETAIL/);
    r=await fetch(`${base}/api/items/x`,{method:'PUT',body:'x'.repeat(MAX_BODY_BYTES+10)});assert.equal(r.status,413);
    r=await fetch(`${base}/api/items/x`,{headers:{origin:'http://evil.test'}});assert.equal(r.status,403);
    r=await fetch(`${base}/api/items/x`,{headers:{origin:'http://allowed.test'}});assert.equal(r.status,200);assert.equal(r.headers.get('access-control-allow-origin'),'http://allowed.test');
    r=await fetch(`${base}/api/items/x`,{method:'OPTIONS',headers:{origin:'http://allowed.test'}});assert.equal(r.status,204);
  }finally{await close();}
});

test('vault encrypts at rest, hints without leaking, and refuses a foreign key',()=>{
  const dir=mkdtempSync(join(tmpdir(),'psp-studio-vault-'));
  try{
    const vault=new Vault(dir);
    assert.equal(vault.mode,'key-file');
    assert.deepEqual(vault.list().map(s=>s.configured),[false,false,false]);
    const summary=vault.set('openai.apiKey','sk-synthetic-0123456789abcdef');
    assert.equal(summary.hint,'…cdef');
    assert.equal(vault.get('openai.apiKey'),'sk-synthetic-0123456789abcdef');
    const raw=readFileSync(join(dir,'vault.json'),'utf8');
    assert.doesNotMatch(raw,/sk-synthetic/);
    assert.throws(()=>vault.set('openai.apiKey',''),{code:'INVALID_SECRET'});
    assert.throws(()=>vault.set('nope','x'),{code:'UNKNOWN_SECRET'});
    const generated=vault.generateSigning('ed25519','studio-key');
    assert.equal(Buffer.from(generated.publicKey,'base64').length,32);
    assert.equal(vault.describeSigning().keyId,'studio-key');
    assert.equal(vault.signingKey().material.length,32);
    const reopened=new Vault(dir);
    assert.equal(reopened.get('openai.apiKey'),'sk-synthetic-0123456789abcdef');
    writeFileSync(join(dir,'vault.key'),Buffer.alloc(32,7));
    assert.throws(()=>new Vault(dir).get('openai.apiKey'),{code:'VAULT_KEY_MISMATCH'});
    vault.delete('openai.apiKey');
    assert.equal(vault.has('openai.apiKey'),false);
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test('vault passphrase mode derives the key and rejects the wrong passphrase',()=>{
  const dir=mkdtempSync(join(tmpdir(),'psp-studio-vault-'));
  try{
    const vault=new Vault(dir,'correct horse');
    assert.equal(vault.mode,'passphrase');
    vault.set('anthropic.apiKey','synthetic-anthropic-key-value');
    assert.equal(new Vault(dir,'correct horse').get('anthropic.apiKey'),'synthetic-anthropic-key-value');
    assert.throws(()=>new Vault(dir,'wrong').get('anthropic.apiKey'),{code:'VAULT_KEY_MISMATCH'});
  }finally{rmSync(dir,{recursive:true,force:true});}
});
