// SPDX-License-Identifier: Apache-2.0
// Offline A/B/C execution. Expectations are consumed only by the separate grader.
import {mkdtempSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {fixture} from './llm-fixtures.mjs';
import {BufferedLlmLoop,promptContext} from '@psp-cdl/llmproxy';
import {McpDispatchGate,bindingDigest} from '@psp-cdl/mcpproxy';
import {StdioMcpClient} from '@psp-cdl/mcpproxy/mcp';
import {signEnvelope} from '@psp-cdl/core/crypto';
import {tokenizeDeclaration} from '@psp-cdl/cdl';
import {suite,approval,environment,credential,readEvents,closeApproval} from './topology-common.mjs';

// A transport/orchestration adapter, with no PSP/CDL decision point. The callback
// can be replaced by a host-owned provider; CI supplies a deterministic script.
export async function runDirect(provider,registrations,message,options) {
  const check=()=>{if(options.cancelled())throw Object.assign(Error('CANCELLED'),{code:'CANCELLED'});};
  const messages=[{role:'system',content:'Use the synthetic read tool when needed.'},{role:'user',content:message}];
  const tools=registrations.map(r=>({name:r.server+'.'+r.name,inputSchema:r.inputSchema,outputSchema:r.outputSchema}));
  for(let step=0;step<options.maxSteps;step++) {
    check();const result=await provider.invoke(structuredClone({messages,tools}),options);check();
    if(!result||typeof result!=='object'||Array.isArray(result))throw Object.assign(Error('INVALID_RESPONSE'),{code:'INVALID_RESPONSE'});
    if(result.type==='final'&&typeof result.text==='string')return result.text;
    const tool=registrations.find(r=>r.server+'.'+r.name===result.name);
    if(result.type!=='tool'||!tool||!result.arguments||typeof result.arguments!=='object'||Array.isArray(result.arguments))throw Object.assign(Error('INVALID_RESPONSE'),{code:'INVALID_RESPONSE'});
    let data;
    try {data=await tool.invoke(result.arguments,options);}catch(error){check();throw error;}
    check();messages.push({role:'assistant',call:{name:result.name,arguments:result.arguments}},{role:'tool',name:result.name,data});
  }
  throw Object.assign(Error('STEP_LIMIT'),{code:'STEP_LIMIT'});
}

export async function runCase(c,topology,serverExecutable,serverScript,proxyExecutable,proxyScript) {
  const directory=mkdtempSync(join(tmpdir(),'psp-topology-')),spy=join(directory,'server.jsonl'),proxySpy=join(directory,'proxy.jsonl');
  let peer,f;
  const throughProxy=topology==='C'&&c.kind!=='bypass';
  const events=complete=>readEvents(spy,c.id,complete);
  try {
    const input=c.input,p=input.perturbation;
    const terms=Object.hasOwn(input,'declaration')?tokenizeDeclaration(input.declaration):[];
    f=await fixture({base:{agents:input.agents.join(',')},providerCancel:p==='cancel-before-dispatch',bypassWrite:p==='stale-state',
      displayDenied:p==='display-denial',providerTraining:p==='inference-denial',tamperedPrompt:p==='tampered-prompt',expiredPrompt:p==='expired-prompt',
      responses:[{type:'tool',name:input.requestedAgent.replace('mcp://','').replace('/','.'),arguments:{recordId:input.recordId,...input.extraArguments}},{type:'final',text:'unused'}]});
    peer=await StdioMcpClient.connect({executable:throughProxy?proxyExecutable:serverExecutable,
      args:throughProxy?[proxyScript,c.id,serverExecutable,serverScript,spy,proxySpy]:[serverScript,topology,c.id,spy],
      env:environment(),serverInfo:{name:'psp-cdl-reference',version:'0.1.0'},timeoutMs:8000});
    const registrations=peer.registrations('reference',['allowed','other',...(topology==='A'||c.kind==='bypass'?['export']:[])].map(name=>approval(name,input.capabilities)),f.host.now);
    const control=throughProxy?peer.registrations('fixture-control',[closeApproval()],f.host.now)[0]:null;
    if(throughProxy&&p==='cancel-after-read')for(const r of registrations) {
      const invoke=r.invoke;r.invoke=(args,options)=>invoke(args,{...options,cancelled:()=>false});
    }
    const dispatchPolicy=f.host.policy;
    f.host.policy=async(...args)=>{const result=await dispatchPolicy(...args);result.resources[0].covenants=input.covenants;return result;};
    if(input.kid) {
      f.loopHost.prompt=(_p,b)=>signEnvelope('Use the synthetic read tool when needed.',
        {algorithm:'ed25519',signatureVersion:'2.0',kid:input.kid,timestamp:900,expires:1700,version:'1.0.0',sectionType:'system',contentType:'text',trustLevel:2,attributes:promptContext(b)},new Uint8Array(32).fill(19));
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
    const gate=new McpDispatchGate(f.store,f.host,'registry-1',registrations.filter(r=>r.readOnly));
    const loop=new BufferedLlmLoop(f.store,gate,f.loopHost,provider);
    const options={...f.options,cancelled:()=>!!f.baseFlags.cancelled||(p==='cancel-after-read'&&
      (throughProxy?readEvents(proxySpy,c.id).some(e=>e.kind==='proxy-release'):events(false).some(e=>e.kind==='read')))};
    const codes=[],outputs=[];
    const message=JSON.stringify({message:suite.configuration.userMessage,agents:input.agents,toolCapabilities:input.capabilities,covenants:input.covenants,lexicalTerms:terms});
    const attempt=async()=>{
      try {
        if(topology==='A')outputs.push(await runDirect(provider,registrations,message,options));
        else {
          const result=await loop.run(input.token,f.session.sessionId,{message},options);
          if(result.provenance.trustLevel!==5||result.provenance.outputDigest!==bindingDigest({text:result.text}))throw Error('INVALID_PROVENANCE');
          outputs.push(result.text);
        }
        codes.push('OK');
      }catch(error){if(!error.code)throw error;codes.push(error.code);}
    };
    if(c.kind==='bypass') {
      const data=await registrations.find(r=>r.name==='export').invoke({recordId:input.recordId},options);
      codes.push('OK');outputs.push(data.message);
    }else if(p==='replay-old-prompt') {
      let captured;const prompt=f.loopHost.prompt;
      f.loopHost.prompt=(...args)=>(captured=prompt(...args));await attempt();
      f.loopHost.prompt=()=>captured;await f.update();await attempt();
    }else await attempt();
    const state=await f.store.execute(f.actor,{action:'getSession',sessionId:f.session.sessionId});
    if(control&&!existsSync(spy+'.closed'))await control.invoke({},{...options,cancelled:()=>false});
    await peer.close();peer=null;
    if(throughProxy) {
      for(let i=0;!existsSync(spy+'.closed')&&i<100;i++)await new Promise(r=>setTimeout(r,20));
      if(!existsSync(spy+'.closed'))throw Error('SERVER_CLEANUP_FAILED');
    }
    const observed=events(true),proxyEvents=throughProxy?readEvents(proxySpy,c.id,true):[];
    if(observed[0]?.kind!=='isolation-probes-blocked'||throughProxy&&proxyEvents[0]?.kind!=='isolation-probes-blocked')throw Error('ISOLATION_NOT_OBSERVED');
    const secrets=['test-owner','test-tenant','tenant-a','subject-a','test-signing-key',credential,f.session.sessionId,'sessionVersion','fixture_close'];
    return {codes,terms,providerCalls:f.requests.length,events:observed,proxyEvents,outputs,
      providerToolMessages:f.requests.flatMap(r=>r.messages.filter(m=>m.role==='tool').map(m=>m.data.message)),
      sessionVersion:topology==='A'?null:state.version,authorityLeak:secrets.some(value=>JSON.stringify(f.requests).includes(value))};
  }finally {try{await peer?.close();}finally{f?.close();rmSync(directory,{recursive:true,force:true,maxRetries:20,retryDelay:50});}}
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href) {
  const [topology,...args]=process.argv.slice(2),report=[];
  for(const c of suite.cases.filter(c=>c.expected[topology]!==null)) {
    try {report.push({id:c.id,observation:await runCase(c,topology,...args)});}
    catch(error){report.push({id:c.id,error:'ADAPTER_ERROR'});if(process.env.PSP_MATRIX_DEBUG==='1')process.stderr.write(c.id+': '+String(error)+'\n');}
  }
  console.log(JSON.stringify(report));
}
