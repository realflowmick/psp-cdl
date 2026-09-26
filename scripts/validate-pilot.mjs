// SPDX-License-Identifier: Apache-2.0
import {readFileSync} from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
const schema=JSON.parse(readFileSync(new URL('../schemas/pilot-0.1.schema.json',import.meta.url),'utf8'));
const ajv=new Ajv2020({strict:true,allErrors:true});ajv.addSchema(schema);
export function validatePilot(kind,value) {
  const validator=ajv.getSchema(schema.$id+'#/$defs/'+kind);
  if(!validator||!validator(value))throw Error('INVALID_PILOT_'+kind.toUpperCase());
}
