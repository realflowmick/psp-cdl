// SPDX-License-Identifier: Apache-2.0
import Ajv2020 from 'ajv/dist/2020.js';
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
const schema=JSON.parse(readFileSync(new URL('../schemas/campaign-0.1.schema.json',import.meta.url),'utf8'));
const ajv=new Ajv2020({strict:true,allErrors:true});ajv.addSchema(schema);
const validators=Object.fromEntries(Object.keys(schema.$defs).map(k=>[k,ajv.compile({$ref:schema.$id+'#/$defs/'+k})]));
export function validateCampaign(kind,value){if(!validators[kind]?.(value))throw Object.assign(new Error('INVALID_'+kind.toUpperCase()),{code:'INVALID_'+kind.toUpperCase()});return value;}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){try{const r=JSON.parse(readFileSync(0,'utf8'));validateCampaign(r.kind,r.value);console.log('{"valid":true}');}catch{console.log('{"valid":false}');process.exitCode=2;}}
