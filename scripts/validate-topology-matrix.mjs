// SPDX-License-Identifier: Apache-2.0
import {readFileSync} from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import {pathToFileURL} from 'node:url';
export const schema=JSON.parse(readFileSync(new URL('../schemas/topology-matrix.schema.json',import.meta.url),'utf8'));
const result=JSON.parse(readFileSync(new URL('../schemas/result.schema.json',import.meta.url),'utf8'));
const ajv=new Ajv2020({strict:true,allErrors:true});
ajv.addSchema(result,new URL('result.schema.json',schema.$id).href);
ajv.addSchema(schema);
export function validate(kind,data) {
  const validator=ajv.getSchema(schema.$id+'#/$defs/'+kind);
  if(!validator)throw Error('UNKNOWN_VALIDATOR');
  if(!validator(data))throw Error(JSON.stringify(validator.errors));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href) {
  validate(process.argv[2],JSON.parse(readFileSync(0,'utf8')));
}
