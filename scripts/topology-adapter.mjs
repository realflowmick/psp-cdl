// SPDX-License-Identifier: Apache-2.0
// Offline repository adapter; all identities, keys and data are synthetic.
import {readFileSync, existsSync, mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fixture} from './llm-fixtures.mjs';
import {BufferedLlmLoop, promptContext} from '@psp-cdl/llmproxy';
import {McpDispatchGate, bindingDigest} from '@psp-cdl/mcpproxy';
import {StdioMcpClient} from '@psp-cdl/mcpproxy/mcp';
import {signEnvelope} from '@psp-cdl/core/crypto';

const root=new URL('../',import.meta.url);
const suite=JSON.parse(readFileSync(new URL('conformance/vectors/topologies/matrix-0.1.json',root),'utf8'));
const server=JSON.parse(readFileSync(new URL('conformance/vectors/evaluation/servers-0.1.json',root),'utf8'));

export async function runCase(c,executable,script) {
  const directory=mkdtempSync(join(tmpdir(),'psp-topology-')),spy=join(directory,'events.jsonl');
  let peer,f;
  const events=(complete=false)=>{
    const source=existsSync(spy)?readFileSync(spy,'utf8'):'';
    if(complete&&source&&!source.endsWith('\n'))throw Error('TRUNCATED_EVENT_LOG');
    return source.split('\n').slice(0,-1).filter(Boolean).map(JSON.parse);
  };
  try {
    const input=c.input,perturbation=input.perturbation;
    const toolName=input.requestedAgent.replace('mcp://','').replace('/','.');
    f=await fixture({base:{agents:input.agents.join(',')},
      providerCancel:perturbation==='cancel-before-dispatch',bypassWrite:perturbation==='stale-state',
      displayDenied:perturbation==='display-denial',
      responses:[{type:'tool',name:toolName,arguments:{recordId:input.recordId}},{type:'final',text:'unused'}]});
    peer=await StdioMcpClient.connect({executable,args:[script,'benign',spy,c.id],
      env:{...(process.env.SystemRoot?{SystemRoot:process.env.SystemRoot}:{}),PSP_FIXTURE_CREDENTIAL:'synthetic-fixture-credential'},
      serverInfo:{name:'psp-cdl-reference',version:'0.1.0'},timeoutMs:2000});
    const approval=name=>({name,revision:'1',readOnly:name==='read',complete:true,
      sources:[{id:'host-fixture-registry',capabilities:input.capabilities}],inputSchema:server.inputSchema,outputSchema:server.outputSchema});
    // Host-owned aliases preserve the seed URIs while routing to the pinned read endpoint.
    const [read,...rest]=peer.registrations('reference',[approval('read'),...(c.kind==='bypass'?[approval('export')]:[])],f.host.now);
    const registrations=['allowed','other'].map(name=>({...read,name}));
    const dispatchPolicy=f.host.policy;
    f.host.policy=async(...args)=>{
      const policy=await dispatchPolicy(...args);
      policy.resources[0].covenants=input.covenants;
      return policy;
    };
    if(input.kid) {
      f.loopHost.prompt=(_p,b)=>signEnvelope('Use the synthetic read tool when needed.',
        {algorithm:'hmac-sha256',signatureVersion:'2.0',secretId:input.kid,timestamp:900,expires:1700,version:'1.0.0',
          sectionType:'system',contentType:'text',trustLevel:2,attributes:promptContext(b)},new Uint8Array(32).fill(19));
      f.loopHost.verification=()=>({keys:input.trustedKeys});
    }
    const invoke=f.provider.invoke;
    const provider={...f.provider,invoke:async(request,options)=>{
      const response=await invoke(request,options);
      if(response.type==='final') {
        const message=request.messages.findLast(m=>m.role==='tool');
        if(!message)throw Error('MISSING_TOOL_OBSERVATION');
        return {type:'final',text:message.data.message};
      }
      return response;
    }};
    const gate=new McpDispatchGate(f.store,f.host,'registry-1',registrations);
    const loop=new BufferedLlmLoop(f.store,gate,f.loopHost,provider);
    const options={...f.options,cancelled:()=>!!f.baseFlags.cancelled||
      (perturbation==='cancel-after-read'&&events().some(e=>e.kind==='read'))};
    const codes=[],outputs=[];
    const attempt=async()=>{
      try {
        const result=await loop.run(input.token,f.session.sessionId,{message:suite.configuration.userMessage},options);
        if(result.provenance.trustLevel!==5||result.provenance.outputDigest!==bindingDigest({text:result.text}))throw Error('INVALID_PROVENANCE');
        codes.push('OK');outputs.push(result.text);
      }catch(error){if(!error.code)throw error;codes.push(error.code);}
    };
    if(c.kind==='bypass') {
      // Positive control outside the gate, limited to the isolated synthetic export sink.
      const data=await rest[0].invoke({recordId:input.recordId},options);
      codes.push('OK');outputs.push(data.message);
    }else if(perturbation==='replay-old-prompt') {
      let captured;
      const prompt=f.loopHost.prompt;
      f.loopHost.prompt=(...args)=>(captured=prompt(...args));
      await attempt();
      f.loopHost.prompt=()=>captured;
      await f.update();
      await attempt();
    }else await attempt();
    const state=await f.store.execute(f.actor,{action:'getSession',sessionId:f.session.sessionId});
    await peer.close();peer=null;
    const observed=events(true);
    if(observed[0]?.kind!=='isolation-probes-blocked'||observed.some((e,i)=>e.sequence!==i+1||e.correlation!==c.id))throw Error('INVALID_EVENT_LOG');
    const privateValues=['test-owner','test-tenant','tenant-a','subject-a','test-signing-key','synthetic-fixture-credential',f.session.sessionId,'sessionVersion'];
    return {codes,providerCalls:f.requests.length,events:observed.map(({kind,recordId})=>({kind,recordId})),outputs,
      providerToolMessages:f.requests.flatMap(r=>r.messages.filter(m=>m.role==='tool').map(m=>m.data.message)),
      sessionVersion:state.version,authorityLeak:privateValues.some(value=>JSON.stringify(f.requests).includes(value))};
  }finally {
    try {await peer?.close();}finally {f?.close();rmSync(directory,{recursive:true,force:true});}
  }
}

const [executable,script]=process.argv.slice(2),report=[];
for(const c of suite.cases.filter(c=>c.kind!=='blocked')) {
  try {report.push({id:c.id,observation:await runCase(c,executable,script)});}
  catch {report.push({id:c.id,error:'ADAPTER_ERROR'});}
}
console.log(JSON.stringify(report));
