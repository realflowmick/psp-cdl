# SPDX-License-Identifier: Apache-2.0
import json
import subprocess
import sys
from pathlib import Path
from llm_fixtures import run_case
ROOT=Path(__file__).resolve().parents[1]
subprocess.run([sys.executable,'scripts/generate-context-vectors.py','--check'],cwd=ROOT,check=True)
suite=json.loads((ROOT/'conformance/vectors/llm/in-context-0.1.json').read_text(encoding='utf-8'))
source="""
import {readFileSync} from 'node:fs';
import {runCase} from './scripts/llm-fixtures.mjs';
const suite=JSON.parse(readFileSync('conformance/vectors/llm/in-context-0.1.json','utf8')),out=[];
for(const c of suite.cases)out.push(await runCase(c));console.log(JSON.stringify(out));
"""
peer=subprocess.run(['node','--input-type=module','-e',source],cwd=ROOT,check=True,capture_output=True,text=True,encoding='utf-8')
for c,ts in zip(suite['cases'],json.loads(peer.stdout),strict=True):
    py=run_case(c)
    assert py==ts,(c['id'],'parity mismatch')
    for k,v in c['expected'].items():assert py[k]==v,(c['id'],k,py)
    for request in py['requests']:assert request['messages'][0]['content']==c['settings']['promptText'],c['id']
    if 'expectedText' in c:assert py['result']['text']==c['expectedText'],c['id']
print('5 context cases agree: complete application reaches provider; model output preserved; boundary denials remain enforced. No model reasoning measured.')
