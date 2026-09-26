// SPDX-License-Identifier: Apache-2.0
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
const schema=JSON.parse(readFileSync(new URL('../schemas/study-0.1.schema.json',import.meta.url),'utf8'));
const ajv=new Ajv2020({strict:true,allErrors:true});ajv.addSchema(schema);
export function validate(kind,value) {
  const validator=ajv.getSchema(schema.$id+'#/$defs/'+kind);
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
