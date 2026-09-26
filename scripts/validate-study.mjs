// SPDX-License-Identifier: Apache-2.0
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
const schemas=[1,2].map(v=>JSON.parse(readFileSync(new URL(`../schemas/study-0.${v}.schema.json`,import.meta.url),'utf8')));
const ajv=new Ajv2020({strict:true,allErrors:true});schemas.forEach(s=>ajv.addSchema(s));
export function validate(kind,value,version=['plan','report'].includes(kind)?value?.schemaVersion:2) {
  const validator=ajv.getSchema(schemas[version-1]?.$id+'#/$defs/'+kind);
  if(!validator||!validator(value))throw Error('INVALID_STUDY_'+kind.toUpperCase());
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href) {
  const kind=process.argv[2],value=JSON.parse(readFileSync(0,'utf8'));
  validate(kind,value);
  if(kind==='capabilities') {
    const {aggregateCapabilities}=await import('@psp-cdl/cdl');
    aggregateCapabilities(value.sources,value.complete);
  }
}
