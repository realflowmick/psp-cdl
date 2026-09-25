// SPDX-License-Identifier: Apache-2.0
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {SecurityToolsService} from '@psp-cdl/api-server/security-tools';
import {handleHttp} from '@psp-cdl/api-server/http';
import {McpServer} from '@psp-cdl/mcp-server';
import {fixture as lifecycleFixture} from './lifecycle-fixtures.mjs';
export const suite=JSON.parse(readFileSync(new URL('../conformance/vectors/services/security-tools-0.1.json',import.meta.url)));
const resource={classes:[],covenants:[],capabilities:[],checks:{},parameters:{},context:{}};
export function fixture(c={}){
  const flags={now:1000,...c.flags},counts={keyCalls:0,releaseCalls:0},principal={tenantId:'tenant-a',subjectId:'subject-a',scopes:['security:scan','security:decrypt','security:process','security:verify','policy:evaluate']};
  const snapshot={...principal,operationId:'op-1',policyVersion:'policy-1',expires:1900,resources:[structuredClone(resource)],verification:{keys:[{id:'test-sign',algorithm:'hmac-sha256',material:Buffer.from(suite.signingKeyHex,'hex'),status:'active',trustLevels:[2],sectionTypes:['system','context','user'],scope:{},allowUnscoped:false}],context:{'tenant-id':'tenant-a','operation-id':'op-1','policy-version':'policy-1'},allowedAttributes:['tenant-id','operation-id','policy-version','encrypted','encryption-algorithm','encryption-key-id','nonce','tag','decrypt']}};
  if(flags.policyDenies)Object.assign(snapshot.resources[0],{covenants:['no-collect'],capabilities:['collects-data']});
  const host={
    now:()=>flags.now,
    authenticate:t=>flags.revoked?null:t==='test-owner'?principal:t==='reader'?{...principal,scopes:[]}:t==='other-owner'?{...principal,subjectId:'other'}:t==='other-tenant'?{...principal,tenantId:'other'}:null,
    resolve:()=>snapshot,
    resolveDecryption:(_p,c)=>{
      counts.keyCalls++;if(flags.throwKey)throw new Error('PRIVATE_KEY_BACKEND');if(flags.missingKey)return null;
      return {...c,tenantId:flags.wrongTenantGrant?'other':'tenant-a',subjectId:flags.wrongOwnerGrant?'other':'subject-a',envelopeDigest:flags.wrongDigest?'0'.repeat(64):c.envelopeDigest,algorithm:'aes-256-gcm',material:flags.wrongKey?Buffer.alloc(32):Buffer.from(suite.encryptionKeyHex,'hex'),status:flags.revokedKey?'revoked':'active',expires:flags.expiredGrant?1000:1800,requestingZone:flags.zoneDenied?2:0,sectionTypes:['system','context'],modes:flags.modeDenied?[]:['upfront','node','on-request'],applicationOnly:!flags.bootstrapDenied};
    },
    plaintextPolicy:(_p,c)=>{
      counts.releaseCalls++;if(flags.throwRelease)throw new Error('PRIVATE_POLICY_BACKEND');
      if(flags.mutateOutput)c.outputs[0].content='TAMPERED';
      if(flags.revokeAtRelease)flags.revokedKey=true;
      if(flags.revokeSigningAtRelease)snapshot.verification.keys[0].status='revoked';
      if(flags.expireAtRelease)flags.now=2000;
      if(flags.changePolicyAtRelease)snapshot.policyVersion='policy-2';
      if(flags.revokeCredentialAtRelease)flags.revoked=true;
      return {allow:flags.truthyRelease?'yes':!flags.denyRelease,complete:!flags.incompleteRelease,resources:[{...structuredClone(resource),covenants:flags.releasePolicyDenies?['no-display-to-operator']:[],capabilities:flags.releasePolicyDenies?['can-display-to-operator']:[]}]};
    }
  };
  const replace=v=>typeof v==='string'?(suite.contents[v]??v):Array.isArray(v)?v.map(replace):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).map(([k,x])=>[k,replace(x)])):v;
  const request=replace(c.request??{operation_id:'op-1',raw_text:'@text'});if(flags.oversize)request.raw_text='🧪'.repeat(300000);
  return {service:new SecurityToolsService(host),host,flags,counts,snapshot,request,token:flags.token??'test-owner'};
}
export async function runCase(c,mode='http',observe){
  const f=fixture(c);let status,body,rpcError=false;
  if(mode==='http'){
    const r=await handleHttp(f.service,{method:'POST',path:'/v1/security/'+c.operation,headers:[['authorization','Bearer '+f.token],['content-type','application/json']],body:Buffer.from(JSON.stringify(f.request))});status=r.status;body=JSON.parse(r.body);
  }else{
    const peer=new McpServer(f.service,()=>f.token);
    await peer.handle(JSON.stringify({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'test',version:'1'}}}));
    await peer.handle(JSON.stringify({jsonrpc:'2.0',method:'notifications/initialized'}));
    const r=await peer.handle(JSON.stringify({jsonrpc:'2.0',id:2,method:'tools/call',params:{name:'realflow.security.'+c.operation,arguments:f.request}}));
    rpcError=!!r.error;body=r.result?.structuredContent??(r.result?.content?JSON.parse(r.result.content[0].text):{error:{code:r.error.message}});status=body.error?c.expect.status:200;
  }
  assert.equal(status,c.expect.status,c.id+': '+JSON.stringify(body));
  if(c.expect.error)assert.equal(body.error.code,mode==='mcp'&&c.flags.oversize?'Parse error':c.expect.error,c.id);
  if(c.expect.errors)assert.deepEqual(body.results.map(r=>r.error??null),c.expect.errors,c.id);
  if(c.expect.contents)assert.deepEqual(body.results.map(r=>r.content??null),c.expect.contents,c.id);
  if('untrustedText' in c.expect)assert.equal(body.untrustedText,c.expect.untrustedText,c.id);
  if('success' in c.expect)assert.equal(body.success,c.expect.success,c.id);
  for(const k of ['keyCalls','releaseCalls'])if(k in c.expect)assert.equal(f.counts[k],c.expect[k],c.id+': '+k);
  assert(!JSON.stringify(body).includes('PRIVATE_'));assert(!JSON.stringify(body).includes(suite.encryptionKeyHex));
  if(observe&&!rpcError)observe(c,status,body);
  return {status,body,counts:f.counts};
}
export async function combinedFixture(){
  const f=await lifecycleFixture(),s=fixture(),authenticate=s.host.authenticate;
  s.host.authenticate=t=>{const p=authenticate(t);return p?{...p,scopes:[...p.scopes,...f.principal.scopes]}:null;};
  return {service:new SecurityToolsService(s.host,f.service),close:f.close};
}
