// SPDX-License-Identifier: Apache-2.0
import {spawnSync} from 'node:child_process';
import {mkdtempSync,readFileSync,existsSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {suite,runMediationCase,mediationFixture,messages,summarize} from './mediation-fixtures.mjs';
import {serveStdio} from '@psp-cdl/mcp-server/stdio';
const [mode,...args]=process.argv.slice(2);
if(mode==='--report') {
  const report=[];for(const c of suite.cases)report.push(await runMediationCase(c));
  console.log(JSON.stringify(report));
}else if(mode==='--proxy') {
  const [executable,script,spy,config]=args,f=await mediationFixture(JSON.parse(config),executable,script,spy);
  try {await serveStdio(f.server);}finally{await f.close();}
}else if(mode==='--python-proxy') {
  const [python]=args, directory=mkdtempSync(join(tmpdir(),'psp-wire-'));
  try {
    for(const id of ['successful-round-trip','dispatch-policy-denies','release-policy-denies','node-affinity-denies','discovery-drift-before','discovery-drift-after','unvalidated-text','metadata-grants-no-authority','method-is-not-forwarded']) {
      const c=suite.cases.find(c=>c.id===id),spy=join(directory,id);
      const process=spawnSync(python,[fileURLToPath(new URL('./mediation_probe.py',import.meta.url)),'--proxy',globalThis.process.execPath,fileURLToPath(new URL('./mediation-peer.mjs',import.meta.url)),spy,JSON.stringify(c)],{input:messages(c).map(m=>JSON.stringify(m)).join('\n')+'\n',encoding:'utf8',timeout:20000,windowsHide:true});
      assert.equal(process.status,0,process.stderr);
      const replies=process.stdout.trim().split('\n').map(JSON.parse),calls=existsSync(spy)?readFileSync(spy,'utf8').trim().split('\n').length:0;
      const result=summarize(replies,calls);
      for(const [k,v] of Object.entries(c.expected))assert.deepEqual(result[k],v,id+': '+JSON.stringify(result));
      assert(!process.stdout.includes('PRIVATE_'));
    }
    console.log('Node client -> Python proxy -> Node downstream passed nine real stdio chains.');
  }finally{rmSync(directory,{recursive:true,force:true});}
}
