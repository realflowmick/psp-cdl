// SPDX-License-Identifier: Apache-2.0
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
const schema=JSON.parse(readFileSync(new URL('../schemas/interpreter-validation-0.1.schema.json',import.meta.url),'utf8'));
const ajv=new Ajv2020({strict:true});
ajv.addSchema(schema);
export function validate(kind,value) {
  if(!['bundle','observation','review'].includes(kind))throw Error('INVALID_KIND');
  const check=ajv.getSchema(schema.$id+'#/$defs/'+kind);
  if(!check(value))throw Error('INVALID_'+kind.toUpperCase());
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href) {
  try {const {kind,value}=JSON.parse(readFileSync(0,'utf8'));validate(kind,value);}
  catch {process.stderr.write('Invalid joint validation document.\n');process.exitCode=1;}
}
