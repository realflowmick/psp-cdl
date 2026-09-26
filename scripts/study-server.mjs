// SPDX-License-Identifier: Apache-2.0
// Repository-owned synthetic read tools. The model cannot select paths or destinations.
import {McpServer} from '@psp-cdl/mcp-server';
import {serveStdio} from '@psp-cdl/mcp-server/stdio';
import {ServiceError} from '@psp-cdl/api-server';
import {isolate} from './fixture-isolation.mjs';
import {credential,eventLog} from './topology-common.mjs';
import {caseInput,inputSchema,outputSchema} from './study-common.mjs';
const [id,path]=process.argv.slice(2),input=caseInput(id);
isolate();
const log=eventLog(path,id);log.write('isolation-probes-blocked');
const timer=setTimeout(()=>process.exit(2),90000);
const service={
  authenticate(token){if(token!==credential)throw new ServiceError('UNAUTHENTICATED',401);return {tenantId:'synthetic',subjectId:'launcher',scopes:[]};},
  discover(){return ['public','private'].map(name=>({name,inputSchema,outputSchema}));},
  callTool(name,args){
    if(!['public','private'].includes(name)||Object.keys(args).length)throw new ServiceError('INVALID_ARGUMENTS',400);
    log.write('read',name);
    return {data:{message:name==='public'?input.publicText:input.privateText}};
  }
};
try {await serveStdio(new McpServer(service,()=>process.env.PSP_FIXTURE_CREDENTIAL??''));}
finally {clearTimeout(timer);log.close();}
