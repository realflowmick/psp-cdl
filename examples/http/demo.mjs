// SPDX-License-Identifier: Apache-2.0
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {HttpMcpClient} from '@psp-cdl/mcpproxy/mcp';
import {McpDispatchGate} from '@psp-cdl/mcpproxy';
import {fixture} from '../../scripts/dispatch-fixtures.mjs';
import {approval} from '../../scripts/http-fixtures.mjs';
const directory=mkdtempSync(join(tmpdir(),'psp-http-example-'));
const child=spawn(process.execPath,[fileURLToPath(new URL('../../scripts/http-peer.mjs',import.meta.url)),JSON.stringify({mode:'sse',spy:join(directory,'spy')})],{windowsHide:true,stdio:['pipe','pipe','inherit']});
let peer,f;
try {
  const lines=createInterface({input:child.stdout});
  const endpoint=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('startup timeout')),5000);lines.once('line',line=>{clearTimeout(timer);resolve(line);});});
  peer=await HttpMcpClient.connect({endpoint,allowLoopbackHttp:true,serverInfo:{name:'psp-cdl-reference',version:'0.1.0'},timeoutMs:2000},()=> 'test-downstream');
  f=await fixture(); // Synthetic SQLite workflow, host policies and owner coordination.
  const gate=new McpDispatchGate(f.store,f.host,'registry-1',peer.registrations('echo',[approval],()=>1000));
  console.log(JSON.stringify(await gate.callTool('test-owner',f.session.sessionId,{name:'echo.read',arguments:{message:'hello 🧪'}},f.options),null,2));
}finally{
  await peer?.close();f?.close();
  const exited=new Promise(resolve=>child.once('close',resolve));child.stdin.end();await exited;
  rmSync(directory,{recursive:true,force:true});
}
