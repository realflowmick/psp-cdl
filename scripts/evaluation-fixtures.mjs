// SPDX-License-Identifier: Apache-2.0
import {mkdtempSync,readFileSync,existsSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fixture} from './dispatch-fixtures.mjs';
import {McpDispatchGate} from '@psp-cdl/mcpproxy';
import {StdioMcpClient} from '@psp-cdl/mcpproxy/mcp';
import {parseEnvelope} from '@psp-cdl/core';
import {verifySignature} from '@psp-cdl/core/crypto';
const suite=JSON.parse(readFileSync(new URL('../conformance/vectors/evaluation/servers-0.1.json',import.meta.url),'utf8'));
const signatures=JSON.parse(readFileSync(new URL('../conformance/vectors/signatures/profile-2.0.json',import.meta.url),'utf8'));
export async function runCase(c,executable,script) {
  const directory=mkdtempSync(join(tmpdir(),'psp-evaluation-')),spy=join(directory,'events.jsonl');
  const events=()=>existsSync(spy)?readFileSync(spy,'utf8').split('\n').slice(0,-1).filter(Boolean).map(JSON.parse):[];
  try {
  let peer,f,code='OK',data=null,signatureVerified=false;
  try {
    f=await fixture(c.settings);
    peer=await StdioMcpClient.connect({executable,args:[script,c.mode,spy,c.id],
      env:{...(process.env.SystemRoot?{SystemRoot:process.env.SystemRoot}:{}),PSP_FIXTURE_CREDENTIAL:'synthetic-fixture-credential'},
      serverInfo:{name:'psp-cdl-reference',version:'0.1.0'},timeoutMs:2000});
    const approval=name=>({name,revision:'1',readOnly:name==='read',sources:[{id:'host-fixture-registry',capabilities:[]}],complete:true,inputSchema:suite.inputSchema,outputSchema:suite.outputSchema});
    const registrations=peer.registrations('echo',[approval('read'),...(c.bypass?[approval('export')]:[])],()=>f.flags.now);
    const options={deadline:1800,cancelled:()=>!!f.flags.cancelled||(!!c.cancelOnRead&&events().some(e=>e.kind==='read'))};
    const args={recordId:c.recordId,...c.extraArguments};
    if(c.bypass) data=await registrations.find(r=>r.name==='export').invoke(args,options);
    else {
      const gate=new McpDispatchGate(f.store,f.host,'registry-1',registrations);
      const result=await gate.callTool('test-owner',f.session.sessionId,{name:'echo.'+(c.tool??'read'),arguments:args},options);
      if(result.provenance.trustLevel!==5||JSON.stringify(result).includes('"approved":true'))throw Error('FORGED_PROVENANCE_RELEASED');
      data=result.data;
    }
    if(c.mode==='signed-malicious')signatureVerified=verifySignature(parseEnvelope(data.message),Buffer.from(signatures.testKeys.ed25519.publicKeyHex,'hex'));
  } catch(error) {if(!error.code)throw error;code=error.code;}
  finally {await peer?.close();f?.close();}
    const observed=events();
    if(observed[0]?.kind!=='isolation-probes-blocked')throw Error('ISOLATION_NOT_OBSERVED');
    return {id:c.id,code,events:observed,reads:observed.filter(e=>e.kind==='read').length,exports:observed.filter(e=>e.kind==='export').length,
      released:data===null?0:1,canaryReleased:JSON.stringify(data).includes(suite.records.restricted),signatureVerified};
  } finally {rmSync(directory,{recursive:true,force:true});}
}
const [executable,script]=process.argv.slice(2);
const report=[];
for(const c of suite.cases)report.push(await runCase(c,executable,script));
console.log(JSON.stringify(report));
