// SPDX-License-Identifier: Apache-2.0
// A dedicated governed server. Its policy comes only from launcher-selected fixtures.
import {McpServer} from '@psp-cdl/mcp-server';
import {serveStdio} from '@psp-cdl/mcp-server/stdio';
import {ServiceError} from '@psp-cdl/api-server';
import {evaluatePolicy} from '@psp-cdl/cdl';
import {isolate} from './fixture-isolation.mjs';
import {writeFileSync} from 'node:fs';
import {records,credential,caseById,resource,eventLog,closeApproval} from './topology-common.mjs';
const [topology,id,path]=process.argv.slice(2),c=caseById(id);
if(!['A','B','C'].includes(topology))throw Error('INVALID_TOPOLOGY');
isolate();
const log=eventLog(path,id);log.write('isolation-probes-blocked');
const timer=setTimeout(()=>process.exit(2),30000);
let closed=false;
const shutdown=()=>{if(!closed){closed=true;log.close();writeFileSync(path+'.closed','closed');setTimeout(()=>process.exit(0),1000);}};
const service={
  authenticate(token){if(token!==credential)throw new ServiceError('UNAUTHENTICATED',401);return {tenantId:'synthetic',subjectId:'launcher',scopes:[]};},
  discover(){return [...['allowed','other','export'].map(name=>({name,inputSchema:records.inputSchema,outputSchema:records.outputSchema})),closeApproval()];},
  callTool(name,args){
    if(name==='fixture_close'&&Object.keys(args).length===0) {
      shutdown();
      return {data:{closed:true}};
    }
    if(closed)throw new ServiceError('FIXTURE_CLOSED',403);
    if(!['allowed','other','export'].includes(name)||Object.keys(args).join(',')!=='recordId'||!Object.hasOwn(records.records,args.recordId))throw new ServiceError('INVALID_ARGUMENTS',400);
    log.write(name==='export'?'export':'read',args.recordId);
    if(topology==='C') {
      const decision=evaluatePolicy(resource(['no-training'],c.input.perturbation==='server-output-denial'?['used-for-model-training']:[]));
      log.write('server-output',args.recordId,decision.decision.toUpperCase());
      if(decision.decision!=='allow'){shutdown();throw new ServiceError('OUTPUT_DENIED',403);}
    }
    return {data:{message:records.records[args.recordId]}};
  }
};
try {await serveStdio(new McpServer(service,()=>process.env.PSP_FIXTURE_CREDENTIAL??''));}
finally {clearTimeout(timer);if(!closed)log.close();writeFileSync(path+'.closed','closed');}
