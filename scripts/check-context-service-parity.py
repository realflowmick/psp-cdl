# SPDX-License-Identifier: Apache-2.0
import json
import subprocess
import sys
from context_service_fixtures import SUITE, ROOT, run_case
subprocess.run([sys.executable,'scripts/generate-context-service-vectors.py','--check'],cwd=ROOT,check=True)
source="import {suite,runCase} from './scripts/context-service-fixtures.mjs'; const out=[]; for(const c of suite.cases)out.push(await runCase(c)); console.log(JSON.stringify(out));"
peer=subprocess.run(['node','--input-type=module','-e',source],cwd=ROOT,check=True,capture_output=True,text=True,encoding='utf-8')
for case,ts in zip(SUITE['cases'],json.loads(peer.stdout),strict=True):
    py=run_case(case)
    assert py==ts,(case['id'],py,ts)
    for key,value in case['expected'].items():assert py[key]==value,(case['id'],key,py)
print(f"{len(SUITE['cases'])} context/service cases agree, including real writes, denials, checkpoint/resume and candidate delivery. No model reasoning measured.")
ts=subprocess.run(['node','examples/in-context/service/run.mjs'],cwd=ROOT,check=True,capture_output=True,text=True,encoding='utf-8')
py=subprocess.run([sys.executable,'examples/in-context/service/run.py'],cwd=ROOT,check=True,capture_output=True,text=True,encoding='utf-8')
assert [json.loads(line) for line in ts.stdout.splitlines()]==[json.loads(line) for line in py.stdout.splitlines()]
assert all(json.loads(line)['code']=='OK' for line in py.stdout.splitlines())
print('Both standalone context/service examples agree.')
