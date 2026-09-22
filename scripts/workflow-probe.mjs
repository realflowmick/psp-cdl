// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {suite,runCase,fixture} from './workflow-fixtures.mjs';
import {createHttpServer} from '@psp-cdl/api-server/http';
import {McpServer} from '@psp-cdl/mcp-server';
import {serveStdio} from '@psp-cdl/mcp-server/stdio';

async function flow(call) {
  const created=await call('sessions/create',{requestId:'wire-create',nodeId:'entry',nodeVersion:'1',expiresAt:1900,state:{stage:'created'}});
  assert.equal(created.result.version,1);const sessionId=created.result.sessionId;
  const save={requestId:'wire-save',sessionId,expectedVersion:1,nodeId:'next',nodeVersion:'1',status:'running',state:{stage:'saved'}};
  assert.equal((await call('sessions/update',save)).result.version,2);
  const checkpoint=await call('checkpoints/create',{requestId:'wire-pause',sessionId,expectedVersion:2,expiresAt:1500});
  assert.equal(checkpoint.result.sessionVersion,3);assert(!JSON.stringify(checkpoint).includes('resumeToken'));
  const resume={requestId:'wire-resume',checkpointId:checkpoint.result.checkpointId,state:{stage:'resumed'}};
  const result=await call('checkpoints/resume',resume);assert.equal(result.result.version,4);
  assert.deepEqual(await call('checkpoints/resume',resume),result);
  assert.equal((await call('sessions/get',{sessionId})).result.view.stage,'resumed');
}
const mode=process.argv[2];
if(mode==='--report') {
  const report=[];for(const c of suite.cases)report.push({id:c.id,results:await runCase(c)});
  console.log(JSON.stringify(report));
} else if(mode==='--http-client') {
  await flow(async(route,args)=>{
    const response=await fetch(process.argv[3]+'/v1/'+route,{method:'POST',headers:{authorization:'Bearer test-owner','content-type':'application/json'},body:JSON.stringify(args),signal:AbortSignal.timeout(5000)});
    assert.equal(response.status,200);return response.json();
  });console.log('Node workflow client passed against Python HTTP.');
} else if(mode==='--python-stdio') {
  const child=spawn(process.argv[3],['scripts/workflow_probe.py','--stdio'],{stdio:['pipe','pipe','inherit']});
  const lines=createInterface({input:child.stdout})[Symbol.asyncIterator]();let id=0;
  const request=async(method,params)=>{
    child.stdin.write(JSON.stringify({jsonrpc:'2.0',id:++id,method,params})+'\n');
    const line=await lines.next();assert(!line.done);const result=JSON.parse(line.value);assert(!result.error,JSON.stringify(result));return result.result;
  };
  const timeout=setTimeout(()=>child.kill(),15000);
  try {
    await request('initialize',{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'workflow-node',version:'1'}});
    child.stdin.write(JSON.stringify({jsonrpc:'2.0',method:'notifications/initialized'})+'\n');
    const discovery=await request('tools/list',{});assert.equal(discovery.tools.length,8);
    await flow(async(route,args)=>{const r=await request('tools/call',{name:'realflow.'+route.replace('/','.'),arguments:args});assert.equal(r.isError,false);return r.structuredContent;});
    child.stdin.end();await new Promise((resolve,reject)=>{child.on('exit',code=>code===0?resolve():reject(new Error('stdio peer exit '+code)));child.on('error',reject);});
    console.log('Node workflow client passed against Python MCP stdio.');
  } finally {clearTimeout(timeout);child.kill();}
} else {
  const f=await fixture();
  if(mode==='--stdio') {try {await serveStdio(new McpServer(f.service,()=> 'test-owner'));} finally {f.close();}}
  else if(mode==='--http-server') {
    const server=createHttpServer(f.service);
    server.listen(0,'127.0.0.1',()=>console.log(server.address().port));
    process.stdin.resume();process.stdin.on('end',()=>{server.closeAllConnections();server.close(()=>f.close());});
  } else {f.close();throw new Error('Unknown probe mode');}
}
