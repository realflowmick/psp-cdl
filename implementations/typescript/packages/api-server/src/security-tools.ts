// SPDX-License-Identifier: Apache-2.0
import {createHash,createDecipheriv} from "node:crypto";
import {PspError,byteLength,canonicalJson,parseMarkup,record,sectionToEnvelope,validateJson,type Section,type Envelope} from "@psp-cdl/core";
import {verifyEnvelope} from "@psp-cdl/core/crypto";
import {evaluateBatch,type PolicyInput} from "@psp-cdl/cdl";
import {SecurityService,ServiceError,identifier,requestObject,scopeFor,MAX_REQUEST_BYTES,type ServiceHost,type Operation,type OperationSnapshot,type Principal} from "./service.js";
import type {WorkflowService} from "./workflow.js";

export const SECURITY_TOOLS_PROFILE="PSP-SECURITY-TOOLS-0.1";
export const MAX_PLAINTEXT_BYTES=65_536;
export interface DecryptionContext {
  operationId:string;policyVersion:string;envelopeDigest:string;keyId:string;sectionType:string;mode:string;
}
export interface DecryptionGrant extends DecryptionContext {
  tenantId:string;subjectId:string;algorithm:"aes-256-gcm";material:Uint8Array;status:"active"|"revoked";
  expires:number;requestingZone:number;sectionTypes:string[];modes:string[];applicationOnly:boolean;
}
export interface PlaintextContext {
  operationId:string;policyVersion:string;operation:"decrypt"|"process";
  outputs:Record<string,unknown>[];
}
export interface SecurityToolsHost extends ServiceHost {
  resolveDecryption(principal:Principal,context:DecryptionContext):DecryptionGrant|null|Promise<DecryptionGrant|null>;
  plaintextPolicy(principal:Principal,context:PlaintextContext):{allow:boolean;complete:boolean;resources:PolicyInput[]}|Promise<{allow:boolean;complete:boolean;resources:PolicyInput[]}>;
}
class ItemError extends Error {constructor(readonly code:string){super(code);}}
function fail(code:string):never {throw new ItemError(code);}
const digest=(e:Envelope)=>createHash("sha256").update(canonicalJson(e)).digest("hex");
function base64(value:unknown,length?:number):Buffer {
  if(typeof value!=="string"||value.length>4*Math.ceil(MAX_PLAINTEXT_BYTES/3)||value.length%4!==0||!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value))fail("INVALID_ENCRYPTION");
  const bytes=Buffer.from(value,"base64");
  if(bytes.toString("base64")!==value||length!==undefined&&bytes.length!==length)fail("INVALID_ENCRYPTION");
  return bytes;
}
function scan(source:unknown):{sections:Section[];untrustedText:boolean} {
  if(typeof source!=="string")throw new ServiceError("INVALID_REQUEST",400);
  const doc=parseMarkup(source),sections:Section[]=[];
  const visit=(section:Section)=>{sections.push(section);if(sections.length>32)throw new ServiceError("SECTION_LIMIT",413);for(const child of section.children)if(child.kind==="section")visit(child);};
  for(const child of doc.children)if(child.kind==="section")visit(child);
  return {sections,untrustedText:doc.children.some(n=>n.kind==="text"&&/[^\t\r\n ]/.test(n.value))};
}
function envelope(section:Section):Envelope {
  if(section.children.some(n=>n.kind==="section"))fail("UNSUPPORTED_NESTING");
  if(!Object.hasOwn(section.attributes,"signature"))fail(section.attributes.encrypted==="true"?"UNSUPPORTED_ENCRYPTION_ORDER":"UNSIGNED_SECTION");
  if(section.attributes.type==="user")fail("UNSUPPORTED_SECTION_TYPE");
  return sectionToEnvelope(section);
}
const encryptionFields=["encrypted","encryption-algorithm","encryption-key-id","nonce","tag"];
function encrypted(e:Envelope):boolean {
  return encryptionFields.some(k=>Object.hasOwn(e.signature.attributes??{},k))||record(e.data)&&(Object.hasOwn(e.data,"encryption")||Object.hasOwn(e.data,"encryptedData"));
}
function parameters(e:Envelope) {
  const attrs=e.signature.attributes??{},mode=attrs.decrypt??"upfront";
  if(!["system","context"].includes(e.signature.sectionType))fail("UNSUPPORTED_SECTION_TYPE");
  if(!["upfront","node","on-request"].includes(mode))fail("UNSUPPORTED_DECRYPT_MODE");
  let algorithm:unknown,keyId:unknown,nonce:unknown,tag:unknown,ciphertext:unknown;
  if(e.signature.contentType==="text") {
    if(attrs.encrypted!=="true"||encryptionFields.some(k=>!Object.hasOwn(attrs,k)))fail("INVALID_ENCRYPTION");
    algorithm=attrs["encryption-algorithm"];keyId=attrs["encryption-key-id"];nonce=attrs.nonce;tag=attrs.tag;ciphertext=e.data;
  } else {
    if(encryptionFields.some(k=>Object.hasOwn(attrs,k))||!record(e.data)||Object.keys(e.data).sort().join(",")!=="encryptedData,encryption"||!record(e.data.encryption)||Object.keys(e.data.encryption).sort().join(",")!=="algorithm,keyId,nonce,tag")fail("INVALID_ENCRYPTION");
    ({algorithm,keyId,nonce,tag}=e.data.encryption);ciphertext=e.data.encryptedData;
  }
  if(algorithm!=="aes-256-gcm")fail("UNSUPPORTED_ENCRYPTION_ALGORITHM");
  if(!identifier(keyId))fail("INVALID_ENCRYPTION");
  return {keyId,mode,nonce:base64(nonce,12),tag:base64(tag,16),ciphertext:base64(ciphertext)};
}
function allowed(resources:unknown):boolean {return Array.isArray(resources)&&resources.length>0&&evaluateBatch(resources).decision==="allow";}
type Prepared={output:Record<string,unknown>;envelope:Envelope;context?:DecryptionContext;grant?:DecryptionGrant};

/** Explicit host integration; plaintext never bypasses the buffered release decision. */
export class SecurityToolsService extends SecurityService {
  override readonly operations:readonly Operation[];
  constructor(private readonly toolsHost:SecurityToolsHost,private readonly workflow?:WorkflowService) {
    super(toolsHost);
    if([toolsHost.resolveDecryption,toolsHost.plaintextPolicy,toolsHost.authenticate,toolsHost.resolve,toolsHost.now].some(f=>typeof f!=="function"))throw new ServiceError("INVALID_CONFIGURATION",500);
    this.operations=["verify","evaluate","scan","decrypt","process",...(workflow?.operations.filter(o=>o!=="verify"&&o!=="evaluate")??[])];
  }
  override async invoke(operation:Operation,value:unknown,token:unknown,expectedIdentity?:Principal):Promise<Record<string,unknown>> {
    if(operation!=="scan"&&operation!=="decrypt"&&operation!=="process") {
      if(operation==="verify"||operation==="evaluate")return super.invoke(operation,value,token,expectedIdentity);
      if(this.workflow){
        const p=await this.authenticate(token);
        if(expectedIdentity&&(expectedIdentity.tenantId!==p.tenantId||expectedIdentity.subjectId!==p.subjectId)||!p.scopes.includes(scopeFor(operation)))throw new ServiceError("FORBIDDEN",403);
        return this.workflow.invoke(operation,value,token,p);
      }
      throw new ServiceError("UNSUPPORTED_OPERATION",404);
    }
    try {
      const principal=await this.authenticate(token),copyPrincipal=()=>validateJson(principal) as unknown as Principal;
      if(expectedIdentity&&(expectedIdentity.tenantId!==principal.tenantId||expectedIdentity.subjectId!==principal.subjectId))throw new ServiceError("FORBIDDEN",403);
      if(!principal.scopes.includes(scopeFor(operation)))throw new ServiceError("FORBIDDEN",403);
      const input=requestObject(value,operation==="decrypt"?["operation_id","sections"]:["operation_id","raw_text"]);
      const fresh=async(version?:string)=>{
        const live=await this.authenticate(token);
        if(live.tenantId!==principal.tenantId||live.subjectId!==principal.subjectId||!live.scopes.includes(scopeFor(operation)))throw new ServiceError("FORBIDDEN",403);
        let s:OperationSnapshot|null;try{s=structuredClone(await this.toolsHost.resolve(copyPrincipal(),input.operation_id as string));}catch{throw new ServiceError("INTERNAL_ERROR",500);}
        if(!s||s.tenantId!==principal.tenantId||s.subjectId!==principal.subjectId||s.operationId!==input.operation_id)throw new ServiceError("NOT_FOUND",404);
        const now=this.toolsHost.now();
        if(!Number.isFinite(now)||now<0||now>Number.MAX_SAFE_INTEGER||!Number.isSafeInteger(s.expires)||!identifier(s.policyVersion))throw new ServiceError("INTERNAL_ERROR",500);
        if(now>=s.expires||version!==undefined&&version!==s.policyVersion)throw new ServiceError("STALE_OPERATION",409);
        const required={"tenant-id":principal.tenantId,"operation-id":s.operationId,"policy-version":s.policyVersion},p=s.verification;
        if(!p||!record(p.context)||Object.entries(required).some(([k,v])=>p.context[k]!==v)||!Array.isArray(p.keys)||p.keys.some(k=>k.allowUnscoped!==false))throw new ServiceError("INTERNAL_ERROR",500);
        if(!allowed(s.resources))throw new ServiceError("POLICY_DENIED",403);
        return {...s,verification:{...p,now}};
      };
      const snapshot=await fresh(),version=snapshot.policyVersion;
      const grant=async(context:DecryptionContext):Promise<DecryptionGrant>=>{
        let g:DecryptionGrant|null;try{g=structuredClone(await this.toolsHost.resolveDecryption(copyPrincipal(),validateJson(context) as unknown as DecryptionContext));}catch{throw new ServiceError("INTERNAL_ERROR",500);}
        const target=context.sectionType==="system"?0:1;
        if(!g||g.tenantId!==principal.tenantId||g.subjectId!==principal.subjectId||Object.entries(context).some(([k,v])=>g![k as keyof DecryptionGrant]!==v)||g.algorithm!=="aes-256-gcm"||g.status!=="active"||!(g.material instanceof Uint8Array)||g.material.length!==32||!Number.isSafeInteger(g.expires)||this.toolsHost.now()>=g.expires||g.applicationOnly!==true||!Number.isInteger(g.requestingZone)||g.requestingZone<0||g.requestingZone>2||g.requestingZone>target||!Array.isArray(g.sectionTypes)||!g.sectionTypes.includes(context.sectionType)||!Array.isArray(g.modes)||!g.modes.includes(context.mode))fail("DECRYPTION_DENIED");
        return g;
      };
      let items:{id:string;section?:Section;content?:string}[],untrustedText=false;
      if(operation==="decrypt") {
        if(!Array.isArray(input.sections)||input.sections.length<1||input.sections.length>32)throw new ServiceError("INVALID_REQUEST",400);
        const ids=new Set<string>();items=input.sections.map(s=>{if(!record(s)||Object.keys(s).sort().join(",")!=="content,id"||!identifier(s.id)||typeof s.content!=="string"||ids.has(s.id))throw new ServiceError("INVALID_REQUEST",400);ids.add(s.id);return {id:s.id,content:s.content};});
      }else{
        const scanned=scan(input.raw_text);untrustedText=scanned.untrustedText;
        if(operation==="process"&&(untrustedText||!scanned.sections.length))throw new ServiceError("UNSUPPORTED_UNTAGGED_INPUT",400);
        items=scanned.sections.map((section,i)=>({id:"section-"+i,section}));
      }
      const results:Record<string,unknown>[]=[],prepared:Prepared[]=[];
      for(const item of items) {
        try {
          let section=item.section;
          if(!section){const doc=parseMarkup(item.content!);if(doc.children.length!==1||doc.children[0]!.kind!=="section")fail("INVALID_SECTION");section=doc.children[0] as Section;}
          const e=verifyEnvelope(envelope(section),snapshot.verification),isEncrypted=encrypted(e);
          if(operation==="scan"){const output={id:item.id,ok:true,encrypted:isEncrypted,sectionType:e.signature.sectionType};results.push(output);prepared.push({output,envelope:e});continue;}
          const provenance={profile:SECURITY_TOOLS_PROFILE,envelopeDigest:digest(e),signatureAlgorithm:e.signature.algorithm,signingKeyId:e.signature.kid??e.signature.secretId,trustLevel:e.signature.trustLevel??2,transformation:isEncrypted?"decrypted":"verified"};
          const candidate:Prepared={output:{id:item.id,ok:true,encrypted:isEncrypted,sectionType:e.signature.sectionType,provenance},envelope:e};
          let content:string;
          if(isEncrypted){
            const p=parameters(e),context={operationId:snapshot.operationId,policyVersion:version,envelopeDigest:provenance.envelopeDigest,keyId:p.keyId,sectionType:e.signature.sectionType,mode:p.mode};
            const g=await grant(context);candidate.context=context;candidate.grant=g;
            const beforeDecrypt=await fresh(version);verifyEnvelope(e,beforeDecrypt.verification);
            if(beforeDecrypt.verification.now>=g.expires)fail("DECRYPTION_DENIED");
            let bytes:Buffer;
            try{const decipher=createDecipheriv("aes-256-gcm",g.material,p.nonce,{authTagLength:16});decipher.setAuthTag(p.tag);bytes=Buffer.concat([decipher.update(p.ciphertext),decipher.final()]);}catch{fail("DECRYPTION_FAILED");}
            if(bytes.length>MAX_PLAINTEXT_BYTES)fail("PLAINTEXT_LIMIT");
            try{content=new TextDecoder("utf-8",{fatal:true,ignoreBOM:true}).decode(bytes);}catch{fail("INVALID_PLAINTEXT");}
          }else{
            if(operation==="decrypt")fail("NOT_ENCRYPTED");
            if(typeof e.data!=="string"||e.signature.contentType!=="text")fail("UNSUPPORTED_PLAINTEXT");content=e.data;
          }
          if(byteLength(content)>MAX_PLAINTEXT_BYTES)fail("PLAINTEXT_LIMIT");
          candidate.output.content=content;prepared.push(candidate);results.push(candidate.output);
        }catch(e){if(e instanceof PspError||e instanceof ItemError)results.push({id:item.id,ok:false,error:e.code});else throw e;}
      }
      if(operation!=="scan"&&prepared.length&&(operation!=="process"||prepared.length===results.length)) {
        await fresh(version);
        let release;try{release=validateJson(await this.toolsHost.plaintextPolicy(copyPrincipal(),{operationId:snapshot.operationId,policyVersion:version,operation,outputs:validateJson(prepared.map(p=>p.output)) as Record<string,unknown>[]}));}catch{throw new ServiceError("INTERNAL_ERROR",500);}
        const permit=record(release)&&release.allow===true&&release.complete===true&&allowed(release.resources);
        for(const p of prepared) {
          try{
            if(!permit)fail("PLAINTEXT_DENIED");
            if(p.context){const latest=await grant(p.context);if(!Buffer.from(latest.material).equals(Buffer.from(p.grant!.material)))fail("DECRYPTION_DENIED");p.grant=latest;}
          }catch(e){if(!(e instanceof ItemError))throw e;delete p.output.content;delete p.output.provenance;p.output.ok=false;p.output.error=e.code;}
        }
      }
      const final=await fresh(version);
      for(const p of prepared)if(p.output.ok===true){try{verifyEnvelope(p.envelope,final.verification);if(p.grant&&final.verification.now>=p.grant.expires)fail("DECRYPTION_DENIED");}catch(e){if(!(e instanceof PspError||e instanceof ItemError))throw e;delete p.output.content;delete p.output.provenance;p.output.ok=false;p.output.error=e.code;}}
      if(operation==="process"&&results.some(r=>r.ok!==true))for(const r of results)if(r.ok===true){delete r.content;delete r.provenance;r.ok=false;r.error="BATCH_REJECTED";}
      const successful=results.filter(r=>r.ok===true).length;
      const output={profile:SECURITY_TOOLS_PROFILE,operation_id:input.operation_id,policy_version:version,success:results.length>0&&successful===results.length,results,summary:{total:results.length,successful,failed:results.length-successful},...(operation!=="decrypt"?{untrustedText}:{})};
      if(byteLength(canonicalJson(output))>MAX_REQUEST_BYTES)throw new ServiceError("RESPONSE_TOO_LARGE",500);
      return output;
    }catch(e){if(e instanceof ServiceError)throw e;if(e instanceof PspError)throw new ServiceError(e.code,400);throw new ServiceError("INTERNAL_ERROR",500);}
  }
}
