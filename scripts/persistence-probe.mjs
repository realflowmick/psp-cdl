// SPDX-License-Identifier: Apache-2.0
// Synthetic subprocess peer for file interchange, crash recovery and races.
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {WorkflowStore,StoreError} from '../implementations/typescript/packages/api-server/dist/persistence.js';
import {SqliteBackend} from '../implementations/typescript/packages/api-server/dist/sqlite.js';
import {runFixture,secret} from './persistence-fixtures.mjs';
const path=process.argv[2], options=JSON.parse(readFileSync(0,'utf8'));
if(options.mode==='fixture') {
  console.log(JSON.stringify(await runFixture(path)));
} else if(options.mode==='crashUncommitted') {
  const db=new DatabaseSync(path);
  db.exec('PRAGMA cache_size=1; PRAGMA cache_spill=ON; BEGIN IMMEDIATE;');
  db.prepare('UPDATE psp_records SET body=?').run(JSON.stringify({uncommitted:'x'.repeat(65536)}));
  process.exit(0);
} else {
  const backend=new SqliteBackend(path,options.epoch??'peer-epoch',()=>options.now??100);
  const store=new WorkflowStore(backend,{resumeSecret:secret,authorizePersistence:async()=>{
    if(options.barrier) {
      writeFileSync(options.barrier.ready,'ready');
      const deadline=Date.now()+15000;
      while(!existsSync(options.barrier.go)) {
        if(Date.now()>deadline) throw Error('barrier timeout');
        await new Promise(resolve=>setTimeout(resolve,20));
      }
    }
    return true;
  }});
  let result;
  try {result={result:await store.execute(options.actor,options.command)};}
  catch(e) {if(!(e instanceof StoreError)) throw e;result={error:e.code};}
  if(options.crashAfterCommit) process.stdout.write(JSON.stringify(result)+'\n',()=>process.exit(0));
  else {backend.close();console.log(JSON.stringify(result));}
}
