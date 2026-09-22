# SPDX-License-Identifier: Apache-2.0
"""Build/install private local artifacts and test them as downstream library consumers."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import uuid

ROOT = Path(__file__).resolve().parents[1]
RUN = ROOT / '.artifacts' / ('package-check-' + uuid.uuid4().hex[:10])
ARTIFACTS = RUN / 'artifacts'
CONSUMER = RUN / 'consumer'
PYTHON = RUN / 'python'
for path in (ARTIFACTS, CONSUMER, PYTHON):
    path.mkdir(parents=True)
NPM = shutil.which('npm.cmd' if os.name == 'nt' else 'npm')
UV = shutil.which('uv')
if not NPM or not UV:
    raise SystemExit('Put npm and uv on PATH before running package checks.')

def run(command, cwd=ROOT):
    result = subprocess.run(command, cwd=cwd, text=True, encoding='utf-8', capture_output=True)
    if result.returncode:
        raise SystemExit(' '.join(str(c) for c in command) + '\n' + result.stdout + result.stderr)
    return result.stdout

components = ('core', 'cdl', 'test-harness', 'api-server', 'mcp-server')
for component in components:
    run([NPM, 'pack', '--workspace', '@psp-cdl/' + component, '--pack-destination', str(ARTIFACTS), '--ignore-scripts'])
    run([UV, 'build', '--package', 'psp-cdl-' + component, '--wheel', '--out-dir', str(ARTIFACTS), '--offline'])
packages = {f'@psp-cdl/{component}': 'file:' + (ARTIFACTS / f'psp-cdl-{component}-0.1.0-dev.0.tgz').as_posix() for component in components}
(CONSUMER / 'package.json').write_text(json.dumps({'private': True, 'type': 'module', 'dependencies': packages}), encoding='utf-8')
run([NPM, 'install', '--ignore-scripts', '--no-audit', '--no-fund'], CONSUMER)
node_source = r'''
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {resolve, sep} from 'node:path';
import * as core from '@psp-cdl/core';
import * as crypto from '@psp-cdl/core/crypto';
import * as cdl from '@psp-cdl/cdl';
import * as harness from '@psp-cdl/test-harness';
import {SecurityService} from '@psp-cdl/api-server';
import {createHttpServer} from '@psp-cdl/api-server/http';
import {McpServer} from '@psp-cdl/mcp-server';
import {serveStdio} from '@psp-cdl/mcp-server/stdio';
import {WorkflowStore} from '@psp-cdl/api-server/persistence';
import {SqliteBackend} from '@psp-cdl/api-server/sqlite';
for(const pkg of ['core','cdl','test-harness','api-server','mcp-server']) assert(fileURLToPath(import.meta.resolve('@psp-cdl/'+pkg)).startsWith(resolve('node_modules')+sep));
const service=new SecurityService({authenticate:()=>null,resolve:()=>{throw new Error('must not resolve');},now:()=>1});
await assert.rejects(()=>service.invoke('evaluate',{operation_id:'op'},'invalid'),{code:'UNAUTHENTICATED'});
assert.equal((await new McpServer(service,()=> 'invalid').handle('{"jsonrpc":"2.0","id":1,"method":"ping"}')).error.message,'UNAUTHENTICATED');
assert.equal(typeof createHttpServer,'function');assert.equal(typeof serveStdio,'function');
const backend=new SqliteBackend(resolve('consumer.sqlite'),'package-test',()=>1);
try {
  const store=new WorkflowStore(backend,{resumeSecret:new Uint8Array(32).fill(42),authorizePersistence:()=>true}); // Synthetic data only.
  const actor={tenantId:'synthetic-tenant',subjectId:'synthetic-subject'};
  await store.execute(actor,{action:'putNode',nodeId:'entry',nodeVersion:'1',definition:{text:'🧪'}});
  const session=await store.execute(actor,{action:'createSession',requestId:'create',nodeId:'entry',nodeVersion:'1',policyVersion:'p1',expiresAt:10,state:{text:'🧪'}});
  assert.deepEqual(await store.execute(actor,{action:'getSession',sessionId:session.sessionId}),session);
} finally {backend.close();}
const source='${psp type=context}hello 🧪${/psp}';
const document=core.documentFromJson(core.documentToJson(core.parseMarkup(source)));
assert.equal(core.serializeMarkup(document),source);
const key=new Uint8Array(32).fill(42); // Public synthetic smoke-test key.
const e=crypto.signDocument(document,{algorithm:'hmac-sha256',signatureVersion:'2.0',secretId:'test',timestamp:1,expires:2,version:'1.0.0',sectionType:'context'},key);
assert(crypto.verifySignature(e,key));
assert.equal(core.serializeMarkup(core.envelopeToDocument(e)),source);
assert.equal(cdl.evaluatePolicy({classes:[],covenants:['no-training'],capabilities:['used-for-model-training'],checks:{},parameters:{},context:{}}).decision,'deny');
assert.equal(cdl.policyTable().rules.length,88);
assert.equal(typeof harness.profileReport,'function');
'''
(CONSUMER / 'smoke.mjs').write_text(node_source, encoding='utf-8')
run(['node', 'smoke.mjs'], CONSUMER)
run([UV, 'pip', 'install', '--python', sys.executable, '--target', str(PYTHON), *[str(p) for p in ARTIFACTS.glob('*.whl')]])
python_source = '''
import sys
from pathlib import Path
target=Path(sys.argv[1]).resolve()
sys.path.insert(0,str(target))
import psp_cdl_core as core
from psp_cdl_core import crypto
import psp_cdl_cdl as cdl
import psp_cdl_test_harness as harness
import psp_cdl_api_server as api
import psp_cdl_mcp_server as mcp
from psp_cdl_api_server.http import create_wsgi_app
from psp_cdl_mcp_server.stdio import serve_stdio
from psp_cdl_api_server.persistence import WorkflowStore
from psp_cdl_api_server.sqlite import SqliteBackend
for module in (core,crypto,cdl,harness,api,mcp):
    assert Path(module.__file__).resolve().is_relative_to(target), module.__file__
source='${psp type=context}hello 🧪${/psp}'
document=core.document_from_json(core.document_to_json(core.parse_markup(source)))
assert core.serialize_markup(document)==source
key=bytes([42])*32
e=crypto.sign_document(document,{'algorithm':'hmac-sha256','signatureVersion':'2.0','secretId':'test','timestamp':1,'expires':2,'version':'1.0.0','sectionType':'context'},key)
assert crypto.verify_signature(e,key)
assert core.serialize_markup(core.envelope_to_document(e))==source
assert cdl.evaluate_policy({'classes':[],'covenants':['no-training'],'capabilities':['used-for-model-training'],'checks':{},'parameters':{},'context':{}})['decision']=='deny'
assert len(cdl.policy_table()['rules'])==88
assert callable(harness.profile_report)
class Host:
    def authenticate(self,token): return None
    def resolve(self,*args): raise AssertionError('must not resolve')
    def now(self): return 1
service=api.SecurityService(Host())
assert mcp.McpServer(service,lambda:'invalid').handle('{"jsonrpc":"2.0","id":1,"method":"ping"}')['error']['message']=='UNAUTHENTICATED'
assert callable(create_wsgi_app(service)) and callable(serve_stdio)
backend=SqliteBackend(str(Path('python-consumer.sqlite').resolve()),'package-test',lambda:1)
try:
    store=WorkflowStore(backend,resume_secret=bytes([42])*32,authorize_persistence=lambda *_:True)  # Synthetic data only.
    actor={'tenantId':'synthetic-tenant','subjectId':'synthetic-subject'}
    store.execute(actor,{'action':'putNode','nodeId':'entry','nodeVersion':'1','definition':{'text':'🧪'}})
    session=store.execute(actor,{'action':'createSession','requestId':'create','nodeId':'entry','nodeVersion':'1','policyVersion':'p1','expiresAt':10,'state':{'text':'🧪'}})
    assert store.execute(actor,{'action':'getSession','sessionId':session['sessionId']})==session
finally:
    backend.close()
'''
run([sys.executable, '-I', '-c', python_source, str(PYTHON)], CONSUMER)
print('Five npm tarballs and five Python wheels passed isolated consumer checks; no packages published.')
