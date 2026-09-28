# SPDX-License-Identifier: Apache-2.0
"""Compare complete graph descriptions, selections and errors in both languages."""
import json
from pathlib import Path
import subprocess
import sys
from psp_cdl_core import PspError, compile_application
ROOT=Path(__file__).resolve().parents[1]
subprocess.run([sys.executable,'scripts/generate-graph-vectors.py','--check'],cwd=ROOT,check=True)
cases=json.loads((ROOT/'conformance/vectors/graphs/profile-0.1.json').read_text(encoding='utf-8'))['cases']
js="""
import {readFileSync} from 'node:fs';
import {compileApplication} from './implementations/typescript/packages/core/dist/index.js';
const cases=JSON.parse(readFileSync(0,'utf8'));
console.log(JSON.stringify(cases.map(c=>{try{const g=compileApplication(c.request);const result={description:g.describe()};if(c.select)result.selection=g.select(...c.select);return {result};}catch(e){return {error:e.code??e.name};}})));
"""
peer=subprocess.run(['node','--input-type=module','-e',js],input=json.dumps(cases),cwd=ROOT,capture_output=True,text=True,encoding='utf-8',check=True)
actual=[]
for c in cases:
    try:
        g=compile_application(c['request']);result={'description':g.describe()}
        if 'select' in c:result['selection']=g.select(*c['select'])
        actual.append({'result':result})
    except PspError as e:actual.append({'error':e.code})
expected=[c['expected'] for c in cases]
if actual!=expected or json.loads(peer.stdout)!=expected:
    for c,py,ts in zip(cases,actual,json.loads(peer.stdout)):
        if py!=c['expected'] or ts!=c['expected']:print(c['id'],'Python:',py,'TypeScript:',ts,'expected:',c['expected'])
    raise SystemExit('Graph parity failed')
print(f'{len(cases)} complete graph descriptions, selections and errors agree')
