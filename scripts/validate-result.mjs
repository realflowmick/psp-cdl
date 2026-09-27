// SPDX-License-Identifier: Apache-2.0
import {readFileSync} from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
const ajv = new Ajv2020({strict:true,allErrors:true});
ajv.addSchema(JSON.parse(readFileSync(new URL('../schemas/result-manifest-0.1.schema.json',import.meta.url),'utf8')));
export function validateResult(kind,value) {
  const validator = ajv.getSchema('https://psp-cdl.org/schemas/result-manifest-0.1.schema.json#/$defs/'+kind);
  if (!validator || !validator(value)) throw Error('INVALID_RESULT_'+kind.toUpperCase()+': '+ajv.errorsText(validator?.errors));
}
