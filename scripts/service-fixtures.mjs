// SPDX-License-Identifier: Apache-2.0
import {readFileSync} from 'node:fs';
import {SecurityService} from '@psp-cdl/api-server';
export const suite=JSON.parse(readFileSync(new URL('../conformance/vectors/services/profile-0.1.json',import.meta.url),'utf8'));
export function fixture(c={}) {
  const snapshot=structuredClone(suite.snapshot);
  snapshot.verification.keys=snapshot.verification.keys.map(({materialHex,...key})=>({...key,material:Buffer.from(materialHex,'hex')}));
  if(c.allow) snapshot.resources[0].capabilities=[];
  if(c.revoked) snapshot.verification.keys[0].status='revoked';
  let resolutions=0, token='public-token-a';
  const service=new SecurityService({authenticate:t=>Object.hasOwn(suite.principals,t)?suite.principals[t]:null,resolve:()=>{resolutions++;if(c.backendFailure)throw new Error('PRIVATE_BACKEND_DETAIL');return snapshot;},now:()=>c.now??suite.now});
  const request={method:c.method??'POST',path:c.path??'/v1/policy/evaluate',headers:[...(c.token===null?[]:[['Authorization','Bearer '+(c.token??'public-token-a')]]),['Content-Type',c.contentType??'application/json'],...(c.extraHeaders??[])],body:Buffer.from(c.rawBody??JSON.stringify(c.request??{operation_id:'op-1'}))};
  return {service,request,snapshot,resolutions:()=>resolutions,credential:()=>token,setToken:t=>{token=t;}};
}
