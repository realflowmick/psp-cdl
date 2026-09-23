// SPDX-License-Identifier: Apache-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import {suite,runCase,TestPeer} from '../../../../../scripts/mcp-refresh-fixtures.mjs';
import {fixture} from '../../../../../scripts/refresh-fixtures.mjs';
import {McpPromptRefresher,RefreshingLlmLoop} from '../dist/index.js';
for(const c of suite.cases)test(`MCP refresh: ${c.id}`,async()=>{
  const actual=await runCase(c);
  for(const [key,value] of Object.entries(c.expected))assert.deepEqual(actual[key],value,JSON.stringify(actual));
  for(const call of actual.wire)assert.deepEqual(Object.keys(call.arguments).sort(),['current_version','session_id','trigger','turn_count']);
});
for(const {id,flags,code,providerCalls} of suite.loopCases)test(`MCP candidate still requires loop checks: ${id}`,async()=>{
  const f=await fixture({base:{now:1100}});Object.assign(f.flags,flags);
  let current,peer;const issue=f.host.refresh;
  try{
    peer=await new TestPeer('normal',r=>issue(current.p,current.b,r)).connect();
    const p=await f.host.authenticate('test-owner');
    const client=new McpPromptRefresher(peer,{principal:p,sessionId:f.session.sessionId,approvedCatalogDigest:peer.catalogDigest,now:()=>f.baseFlags.now,cancelled:()=>f.baseFlags.cancelled===true});
    f.host.refresh=(p,b,r)=>{current={p,b};return client.refresh(p,b,r);};
    const loop=new RefreshingLlmLoop(f.store,f.gate,f.host,f.provider,{postCompletion:'lockdown'});
    let actual='OK';try{await loop.run('test-owner',f.session.sessionId,{message:'hello'},f.options);}catch(e){actual=e.code;}
    assert.equal(actual,code);assert.equal(peer.calls,1);
    assert.equal(f.stats().providerCalls,providerCalls);
    for(const r of f.requests)assert.ok(!JSON.stringify(r).includes('realflow.security.refresh'));
  }finally{await peer?.close();f.close();}
});
