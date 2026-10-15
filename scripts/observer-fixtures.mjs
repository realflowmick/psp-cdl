// SPDX-License-Identifier: Apache-2.0
// Observer wrapper over the existing synthetic fixtures. No credentials, no live providers.
import {readFileSync} from 'node:fs';
import {runCase as runLoop} from './llm-fixtures.mjs';
import {runCase as runDurable} from './durable-fixtures.mjs';
import {runCase as runRefresh} from './refresh-fixtures.mjs';
import {runCase as runContext} from './context-service-fixtures.mjs';
import {runCase as runGate} from './dispatch-fixtures.mjs';
export const suite=JSON.parse(readFileSync(new URL('../conformance/vectors/llm/observer-0.1.json',import.meta.url),'utf8'));
const runners={buffered:runLoop,durable:runDurable,refresh:runRefresh,context:runContext,gate:runGate};
/** Prompt-derived digests bind the random session id; everything else is deterministic. */
export function redact(event) {
  const data={...event.data};
  if(Object.hasOwn(data,'promptDigest'))data.promptDigest='<prompt-digest>';
  if(event.type.startsWith('prompt.')&&Object.hasOwn(data,'digest'))data.digest='<prompt-digest>';
  return {...event,data};
}
export async function runCase(c) {
  const events=[];
  const observer=e=>{events.push(e);if(c.observerThrows)throw new Error('PRIVATE_OBSERVER_DETAIL');};
  const observe={observer,...(c.level?{level:c.level}:{})};
  const inner=c.engine==='context'
    ?{...c.case,flags:{...c.case.flags,observe}}
    :{...c.case,settings:{...c.case.settings,observe,base:{...c.case.settings?.base,observe}}};
  const result=await runners[c.engine](inner);
  const codes=Array.isArray(result.codes)?result.codes:[result.code];
  const sessionId=events.map(e=>e.scope.sessionId).find(v=>typeof v==='string')??null;
  const value={codes,types:events.map(e=>e.source+':'+e.type),events:events.map(redact)};
  const text=JSON.stringify(value);
  return JSON.parse(sessionId?text.replaceAll(sessionId,'<session>'):text);
}
