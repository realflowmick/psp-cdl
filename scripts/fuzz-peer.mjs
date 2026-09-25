// SPDX-License-Identifier: Apache-2.0
// Independent Node consumer/producer. Only public synthetic fixture keys are used.
import {readFileSync} from 'node:fs';
import * as core from '@psp-cdl/core';
import * as crypto from '@psp-cdl/core/crypto';
import * as cdl from '@psp-cdl/cdl';
const suite=JSON.parse(readFileSync(new URL('../conformance/vectors/signatures/profile-2.0.json',import.meta.url),'utf8'));
const seed=Buffer.from(suite.testKeys.ed25519.seedHex,'hex'), pub=Buffer.from(suite.testKeys.ed25519.publicKeyHex,'hex');
export function execute(c) {
  try {
    if(c.op==='json') return {status:'ok',canonical:core.canonicalJson(core.parseJson(c.source))};
    if(c.op==='markup') {
      const doc=core.parseMarkup(c.source), canonical=core.serializeMarkup(doc,'canonical');
      const semantic=core.documentToObject(doc,false);
      if(core.canonicalJson(core.documentToObject(core.parseMarkup(canonical),false))!==core.canonicalJson(semantic)) throw Error('ROUNDTRIP');
      return {status:'ok',canonical,semantic};
    }
    if(c.op==='policy') return {status:'ok',tokens:cdl.normalizeDeclaration('covenants',c.value)};
    if(c.op==='signature') {
      const {value,...metadata}=suite.vectors[1].envelope.signature;
      const envelope=c.envelope??crypto.signEnvelope(c.data,metadata,seed);
      if(!c.envelope && c.variant==='tampered') envelope.data={tampered:true};
      if(!c.envelope && c.variant==='malformed') envelope.signature.value+='=';
      let decision='valid';
      try {
        crypto.verifyEnvelope(envelope,{now:c.variant==='expired'?metadata.expires:metadata.timestamp,
          keys:[{id:metadata.kid,algorithm:'ed25519',material:pub,status:c.variant==='revoked'?'revoked':'active',trustLevels:[2],sectionTypes:['context'],scope:{},allowUnscoped:true}],context:{},allowedAttributes:[]});
      } catch(error) { if(!(error instanceof core.PspError)) throw error; decision=error.code; }
      let inputHex=null;
      try { inputHex=Buffer.from(core.signatureInput(envelope)).toString('hex'); }
      catch(error) { if(!(error instanceof core.PspError)) throw error; }
      return {status:'ok',envelope,decision,inputHex};
    }
    throw Error('UNKNOWN_FUZZ_OPERATION');
  } catch(error) {
    if(!(error instanceof core.PspError)) throw error;
    return {status:'error',code:error.code};
  }
}
const raw=readFileSync(0);
if(raw.length>16*1024*1024) throw Error('FUZZ_INPUT_LIMIT');
const cases=JSON.parse(raw.toString('utf8'));
if(!Array.isArray(cases)||cases.length>64) throw Error('FUZZ_BATCH_LIMIT');
process.stdout.write(JSON.stringify(cases.map(execute)));
