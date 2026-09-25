// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {suite,runCase,fixture,combinedFixture} from './security-tools-fixtures.mjs';
import {createHttpServer} from '@psp-cdl/api-server/http';
import {McpServer} from '@psp-cdl/mcp-server';
import {serveStdio} from '@psp-cdl/mcp-server/stdio';

async function flow(call) {
  for(const c of suite.cases.filter(c=>!Object.keys(c.flags).length&&c.expect.status===200)) {
    const result=await call('security/'+c.operation,fixture(c).request);
    if(c.expect.errors)assert.deepEqual(result.results.map(r=>r.error??null),c.expect.errors,c.id);
    if(c.expect.contents)assert.deepEqual(result.results.map(r=>r.content??null),c.expect.contents,c.id);
    if('success' in c.expect)assert.equal(result.success,c.expect.success);
  }
  const verified=await call('security/verify',{operation_id:'op-1',sections:[{id:'one',content:suite.contents['@plain']}]});assert.equal(verified.summary.valid,1);
  const created=await call('sessions/create',{requestId:'wire-create',nodeId:'entry',nodeVersion:'1',expiresAt:1900,state:{stage:'created'}}),sessionId=created.result.sessionId;
  assert((await call('sessions/list',{after:null,limit:50,status:'all'})).result.sessions.some(s=>s.sessionId===sessionId));
  await call('nodes/fetch',{nodeId:'entry',nodeVersion:'1'});
  await call('sessions/update',{requestId:'wire-update',sessionId,expectedVersion:1,nodeId:'next',nodeVersion:'1',status:'running',state:{stage:'saved'}});
  const checkpoint=await call('checkpoints/create',{requestId:'wire-pause',sessionId,expectedVersion:2,expiresAt:1500});
  await call('checkpoints/resume',{requestId:'wire-resume',checkpointId:checkpoint.result.checkpointId,state:{stage:'resumed'}});
  assert.equal((await call('sessions/get',{sessionId})).result.version,4);
}
const mode=process.argv[2];
if(mode==='--report') {
  const report=[];for(const c of suite.cases)report.push({id:c.id,results:await runCase(c)});
  console.log(JSON.stringify(report));
} else if(mode==='--http-client') {
  await flow(async(route,args)=>{
    const response=await fetch(process.argv[3]+'/v1/'+route,{method:'POST',headers:{authorization:'Bearer test-owner','content-type':'application/json'},body:JSON.stringify(args),signal:AbortSignal.timeout(5000)});
    assert.equal(response.status,200);return response.json();
  });console.log('Node security tools client passed against Python HTTP.');
} else if(mode==='--python-stdio') {
  const child=spawn(process.argv[3],['scripts/security_tools_probe.py','--stdio'],{stdio:['pipe','pipe','inherit']});
  const lines=createInterface({input:child.stdout})[Symbol.asyncIterator]();let id=0;
  const request=async(method,params)=>{
    child.stdin.write(JSON.stringify({jsonrpc:'2.0',id:++id,method,params})+'\n');
    const line=await lines.next();assert(!line.done);const result=JSON.parse(line.value);assert(!result.error,JSON.stringify(result));return result.result;
  };
  const timeout=setTimeout(()=>child.kill(),15000);
  try {
    await request('initialize',{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'workflow-node',version:'1'}});
    child.stdin.write(JSON.stringify({jsonrpc:'2.0',method:'notifications/initialized'})+'\n');
    const discovery=await request('tools/list',{});assert.equal(discovery.tools.length,14);
    await flow(async(route,args)=>{const r=await request('tools/call',{name:'realflow.'+route.replace('/','.'),arguments:args});assert.equal(r.isError,false);return r.structuredContent;});
    child.stdin.end();await new Promise((resolve,reject)=>{child.on('exit',code=>code===0?resolve():reject(new Error('stdio peer exit '+code)));child.on('error',reject);});
    console.log('Node security tools client passed against Python MCP stdio.');
  } finally {clearTimeout(timeout);child.kill();}
} else {
  const f=await combinedFixture();
  if(mode==='--stdio') {try {await serveStdio(new McpServer(f.service,()=> 'test-owner'));} finally {f.close();}}
  else if(mode==='--http-server') {
    const server=createHttpServer(f.service);
    server.listen(0,'127.0.0.1',()=>console.log(server.address().port));
    process.stdin.resume();process.stdin.on('end',()=>{server.closeAllConnections();server.close(()=>f.close());});
  } else {f.close();throw new Error('Unknown probe mode');}
}
