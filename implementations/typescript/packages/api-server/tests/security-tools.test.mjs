// SPDX-License-Identifier: Apache-2.0
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import {suite,fixture,runCase} from '../../../../../scripts/security-tools-fixtures.mjs';
import {fixture as lifecycleFixture} from '../../../../../scripts/lifecycle-fixtures.mjs';
import {SecurityToolsService} from '../dist/security-tools.js';
import {McpServer} from '@psp-cdl/mcp-server';
const schemas=JSON.parse(readFileSync(new URL('../../../../../schemas/api/security-tools-0.1.openapi.json',import.meta.url))).components.schemas,ajv=new Ajv2020({strict:false});
for(const c of suite.cases)for(const mode of ['http','mcp'])test('security tools '+mode+': '+c.id,async()=>{
  await runCase(c,mode,(c,status,body)=>assert(ajv.validate(schemas[status===200?c.operation+'Response':'Error'],body),JSON.stringify(ajv.errors)));
});
test('optional workflow composition advertises all eleven draft counterparts with separate extension tools',async()=>{
  const f=await lifecycleFixture(),s=fixture();
  try{
    const restricted=new SecurityToolsService(s.host,f.service);
    await assert.rejects(restricted.invoke('listSessions',{after:null,limit:10,status:'all'},'test-owner'),e=>e.code==='FORBIDDEN'&&e.status===403);
    const authenticate=s.host.authenticate;s.host.authenticate=t=>{const p=authenticate(t);return p?{...p,scopes:[...p.scopes,...f.principal.scopes]}:null;};
    const service=new SecurityToolsService(s.host,f.service),peer=new McpServer(service,()=> 'test-owner');
    await peer.handle(JSON.stringify({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'test',version:'1'}}}));
    await peer.handle(JSON.stringify({jsonrpc:'2.0',method:'notifications/initialized'}));
    const discovery=await peer.handle(JSON.stringify({jsonrpc:'2.0',id:2,method:'tools/list'}));
    assert.equal(discovery.result.tools.length,14);
    const required=JSON.parse(readFileSync(new URL('../../../../../specs/errata/api-editorial-0.1.json',import.meta.url))).requiredTools.map(t=>t.name);
    assert(required.every(name=>discovery.result.tools.some(t=>t.name===name)));
    const result=await service.invoke('listSessions',{after:null,limit:10,status:'all'},'test-owner');assert.equal(result.result.sessions.length,1);
  }finally{f.close();}
});
