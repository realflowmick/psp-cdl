// SPDX-License-Identifier: Apache-2.0
// This demonstration imports the repository's public synthetic host fixture.
import {fixture} from '../../scripts/dispatch-fixtures.mjs';
const f=await fixture();
try {
  console.log(await f.gate.listTools('test-owner',f.session.sessionId,f.options));
  const request={name:'echo.read',arguments:{message:'hello 🧪'}};
  console.log(await f.gate.callTool('test-owner',f.session.sessionId,request,f.options));
  f.flags.policyDeny=true;
  try {await f.gate.callTool('test-owner',f.session.sessionId,request,f.options);}
  catch(e) {console.log({denied:e.code,...f.stats()});}
}finally{f.close();}
