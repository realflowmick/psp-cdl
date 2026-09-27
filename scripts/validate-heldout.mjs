// SPDX-License-Identifier: Apache-2.0
import {readFileSync} from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
const ajv=new Ajv2020({strict:true,allErrors:true});
for(const file of ['pilot-0.1','study-0.2','heldout-0.1'])ajv.addSchema(JSON.parse(readFileSync(new URL('../schemas/'+file+'.schema.json',import.meta.url),'utf8')));
export function validateHeldout(kind,value){
  const validator=ajv.getSchema('https://psp-cdl.org/schemas/heldout-0.1.schema.json#/$defs/'+kind);
  if(!validator||!validator(value))throw Error('INVALID_HELDOUT_'+kind.toUpperCase()+': '+ajv.errorsText(validator?.errors));
}
