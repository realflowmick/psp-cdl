// SPDX-License-Identifier: Apache-2.0
// Accident prevention for these trusted fixtures, not an arbitrary-code sandbox.
import net from 'node:net';
import tls from 'node:tls';
import http from 'node:http';
import https from 'node:https';
import dgram from 'node:dgram';
import dns from 'node:dns';
import child from 'node:child_process';
import {syncBuiltinESMExports} from 'node:module';
const denied=()=>{throw Object.assign(new Error('FIXTURE_IO_DENIED'),{code:'FIXTURE_IO_DENIED'});};
export function isolate() {
  net.Socket.prototype.connect=denied;
  net.Server.prototype.listen=denied;
  for(const [module,names] of [[net,['connect','createConnection','createServer']],[tls,['connect','createServer']],
    [http,['request','get','createServer']],[https,['request','get','createServer']],[dgram,['createSocket']],
    [dns,['lookup','resolve','resolve4','resolve6','reverse']],[child,['spawn','spawnSync','exec','execSync','execFile','execFileSync','fork']]])
    for(const name of names) module[name]=denied;
  for(const name of Object.keys(dns.promises)) if(typeof dns.promises[name]==='function' && name!=='Resolver') dns.promises[name]=denied;
  globalThis.fetch=async()=>denied();
  syncBuiltinESMExports();
  let blocked=0;
  for(const probe of [()=>net.connect({host:'192.0.2.1',port:9}),()=>child.spawn('fixture-must-not-run')]) {
    try {probe();}catch(error){if(error.code==='FIXTURE_IO_DENIED')blocked++;else throw error;}
  }
  if(blocked!==2)throw Error('FIXTURE_ISOLATION_FAILED');
}
