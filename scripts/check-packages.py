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

components = ('core', 'cdl', 'test-harness')
for component in components:
    run([NPM, 'pack', '--workspace', '@psp-cdl/' + component, '--pack-destination', str(ARTIFACTS), '--ignore-scripts'])
    run([UV, 'build', '--package', 'psp-cdl-' + component, '--wheel', '--out-dir', str(ARTIFACTS), '--offline'])
packages = {f'@psp-cdl/{component}': 'file:' + (ARTIFACTS / f'psp-cdl-{component}-0.1.0-dev.0.tgz').as_posix() for component in components}
(CONSUMER / 'package.json').write_text(json.dumps({'private': True, 'type': 'module', 'dependencies': packages}), encoding='utf-8')
run([NPM, 'install', '--ignore-scripts', '--offline', '--no-audit', '--no-fund'], CONSUMER)
node_source = r'''
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {resolve, sep} from 'node:path';
import * as core from '@psp-cdl/core';
import * as crypto from '@psp-cdl/core/crypto';
import * as cdl from '@psp-cdl/cdl';
import * as harness from '@psp-cdl/test-harness';
for(const pkg of ['core','cdl','test-harness']) assert(fileURLToPath(import.meta.resolve('@psp-cdl/'+pkg)).startsWith(resolve('node_modules')+sep));
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
for module in (core,crypto,cdl,harness):
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
'''
run([sys.executable, '-I', '-c', python_source, str(PYTHON)], CONSUMER)
print('Three npm tarballs and three Python wheels passed isolated consumer checks; no packages published.')
