// SPDX-License-Identifier: Apache-2.0
// Copied into the isolated npm consumer by check-packages.py. Public synthetic keys only.
import assert from 'node:assert/strict';
import {createCipheriv} from 'node:crypto';
import {LifecycleStore} from '@psp-cdl/api-server/lifecycle';
import {SqliteBackend} from '@psp-cdl/api-server/sqlite';
import {SecurityToolsService} from '@psp-cdl/api-server/security-tools';
import {signEnvelope} from '@psp-cdl/core/crypto';
import {serializeMarkup,envelopeToSection} from '@psp-cdl/core';
const actor={tenantId:'test',subjectId:'test'},key=Buffer.alloc(32,7),backend=new SqliteBackend('lifecycle-consumer.sqlite','test',()=>1);
try{
  const store=new LifecycleStore(backend,{resumeSecret:key,authorizePersistence:()=>true,authorizeRetention:()=>true});
  await store.execute(actor,{action:'putNode',nodeId:'entry',nodeVersion:'1',definition:{}});
  const s=await store.execute(actor,{action:'createSession',requestId:'create',nodeId:'entry',nodeVersion:'1',policyVersion:'p1',expiresAt:9,state:{}});
  await store.lifecycle(actor,'cancelSession',{requestId:'cancel',sessionId:s.sessionId,expectedVersion:1},()=>true);
  assert.equal((await store.lifecycle(actor,'purgeSession',{requestId:'purge',sessionId:s.sessionId,expectedVersion:2},()=>true)).more,false);
}finally{backend.close();}
const resource={classes:[],covenants:[],capabilities:[],checks:{},parameters:{},context:{}};
const context={'tenant-id':'test','operation-id':'op','policy-version':'p1'},nonce=Buffer.alloc(12,1),cipher=createCipheriv('aes-256-gcm',key,nonce);
const ciphertext=Buffer.concat([cipher.update('isolated synthetic'),cipher.final()]);
const e=signEnvelope(ciphertext.toString('base64'),{algorithm:'hmac-sha256',signatureVersion:'2.0',secretId:'sign',timestamp:0,expires:9,version:'1.0.0',sectionType:'context',contentType:'text',attributes:{...context,encrypted:'true','encryption-algorithm':'aes-256-gcm','encryption-key-id':'aes',nonce:nonce.toString('base64'),tag:cipher.getAuthTag().toString('base64')}},key);
const content=serializeMarkup({kind:'document',children:[envelopeToSection(e)]});
const host={now:()=>1,authenticate:()=>({...actor,scopes:['security:decrypt']}),resolve:()=>({...actor,operationId:'op',policyVersion:'p1',expires:9,resources:[resource],verification:{context,allowedAttributes:Object.keys(e.signature.attributes),keys:[{id:'sign',algorithm:'hmac-sha256',material:key,status:'active',trustLevels:[2],sectionTypes:['context'],scope:{},allowUnscoped:false}]}}),
  resolveDecryption:(_p,c)=>({...actor,...c,algorithm:'aes-256-gcm',material:key,status:'active',expires:9,requestingZone:0,sectionTypes:['context'],modes:['upfront'],applicationOnly:true}),plaintextPolicy:()=>({allow:true,complete:true,resources:[resource]})};
const result=await new SecurityToolsService(host).invoke('decrypt',{operation_id:'op',sections:[{id:'one',content}]},'synthetic');
assert.equal(result.results[0].content,'isolated synthetic');
