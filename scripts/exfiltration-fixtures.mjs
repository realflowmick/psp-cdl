// SPDX-License-Identifier: Apache-2.0
// Run the shared PSP-EXFIL-0.1 vectors through the TypeScript library. Public synthetic key; never use it for real data.
import {createHash} from 'node:crypto';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ExfiltrationError,ExfiltrationStore,HashingEmbedder,fingerprint,tokenize,windows} from '@psp-cdl/api-server/exfiltration';
export const suite=JSON.parse(readFileSync(new URL('../conformance/vectors/exfiltration/exfiltration-0.1.json',import.meta.url),'utf8'));
export const key=new Uint8Array(Buffer.from(suite.key,'hex'));
/** The sqlite-vec loadable path, or null when the optional package is not installed. */
export async function sqliteVecPath() {
  try { return (await import('sqlite-vec')).getLoadablePath(); } catch { return null; }
}
export function embeddingDigest(text) {
  const v=new HashingEmbedder().embed([text])[0], bytes=new Uint8Array(4*v.length), view=new DataView(bytes.buffer);
  v.forEach((x,i)=>view.setFloat32(4*i,x,true));
  return {sha256:createHash('sha256').update(bytes).digest('hex'),nonzero:v.filter(x=>x!==0).length};
}
export function primitives() {
  return {tokenize:suite.tokenize.map(c=>tokenize(c.text)),windows:suite.windows.map(v=>windows(v.tokens)),
    fingerprints:suite.fingerprints.map(f=>fingerprint(f.text,key)),embeddings:suite.embeddings.map(e=>embeddingDigest(e.text))};
}
export async function openStore(c,path,vector=c.vector) {
  let option='portable';
  if(vector==='sqlite-vec') {
    const loadable=await sqliteVecPath();
    if(!loadable) throw new ExfiltrationError('VECTOR_UNAVAILABLE');
    option={sqliteVec:loadable};
  }
  return new ExfiltrationStore(path,{key,embedder:c.embedder==='hash'?new HashingEmbedder():null,vector:option,...(c.thresholds?{thresholds:c.thresholds}:{}),clock:()=>1000});
}
async function assess(store,c) {
  const out=[];
  for(const o of c.outputs) out.push(await store.assess({application:c.sections[0].application,text:o.text}));
  return out;
}
/** Protect the case's sections in a new store and assess every output. */
export async function runCase(c,path,vector) {
  const directory=path?null:mkdtempSync(join(tmpdir(),'exfil-'));
  const store=await openStore(c,path??join(directory,'store.sqlite'),vector);
  try {
    const protectedSections=[];
    for(const s of c.sections) protectedSections.push(await store.protect({...s}));
    return {protected:protectedSections,assessments:await assess(store,c)};
  } finally { store.close(); if(directory) rmSync(directory,{recursive:true,force:true}); }
}
export async function assessExisting(c,path,vector) {
  const store=await openStore(c,path,vector);
  try { return await assess(store,c); } finally { store.close(); }
}
function subset(actual,expected) {
  if(expected!==null&&typeof expected==='object'&&!Array.isArray(expected))
    return Object.fromEntries(Object.entries(expected).map(([k,v])=>[k,subset(actual!==null&&typeof actual==='object'?actual[k]:undefined,v)]));
  return actual;
}
/** Reduce an assessment to the fields a shared expectation names; sections are keyed by label. */
export function project(actual,expected) {
  const {sections,...rest}=expected, result=subset(actual,rest);
  if(sections) result.sections=Object.fromEntries(actual.sections.map(s=>[s.label,subset(s,sections[s.label]??{})]));
  return result;
}
