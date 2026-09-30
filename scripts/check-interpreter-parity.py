# SPDX-License-Identifier: Apache-2.0
"""Two real language hosts, exchanged observations and independent graders; offline."""
from copy import deepcopy
import json
import subprocess
import sys
from pathlib import Path
from interpreter_validation import grade_case
from joint_interpreter import ROOT, SUITE, read, validate
from provider_fixtures import run_case as run_provider

subprocess.run([sys.executable, 'scripts/generate-interpreter-validation.py', '--check'], cwd=ROOT, check=True)
cases = read(ROOT/SUITE)['cases']


def peer(command, request):
    result = subprocess.run(command, input=json.dumps(request), cwd=ROOT, capture_output=True,
                            text=True, encoding='utf-8', timeout=60)
    if result.returncode:
        raise RuntimeError('Joint interpreter peer failed: '+result.stderr[:1000])
    return json.loads(result.stdout)


for case in cases:
    summaries = []
    for language, command in [('typescript', ['node', 'scripts/interpreter-worker.mjs']),
                              ('python', [sys.executable, 'scripts/interpreter_worker.py'])]:
        observation = peer(command, {'caseId': case['id'], 'mode': 'rehearsal'})
        validate('observation', observation)
        variants = [observation]
        for key, value in [('node', 'wrong'), ('version', 999), ('privateLeak', True), ('trace', []),
                           ('state', {'current_node': observation['actual']['node'], 'governance': 'malformed', 'variables': None})]:
            bad = deepcopy(observation)
            bad['actual'][key] = value
            variants.append(bad)
        grades = peer(['node', 'scripts/interpreter-worker.mjs'], {'action': 'grade-many', 'observations': variants})
        for index, (variant, ts) in enumerate(zip(variants, grades, strict=True)):
            py = grade_case(case, variant)
            assert py == ts, (case['id'], language, index, py, ts)
            assert py['boundaryStatus'] == ('passed' if index == 0 else 'failed'), py
            assert py['behaviorStatus'] == 'not-run'
        a = observation['actual']
        summaries.append({k: a[k] for k in ('code', 'recoveryCode', 'calls', 'toolCalls', 'node', 'version', 'status', 'state', 'events', 'rehydrated')})
    assert summaries[0] == summaries[1], (case['id'], summaries)
print('Six joint interpreter rehearsals agree across real TS/Python hosts and offline provider adapters; 72 exchanged observation grades agree. All semantic scenarios remain not-run.')
source = "import {readFileSync} from 'node:fs'; import {runCase} from './scripts/provider-fixtures.mjs'; const s=JSON.parse(readFileSync('conformance/vectors/llm/openai-context-0.1.json','utf8')); const out=[]; for(const c of s.cases)out.push(await runCase(c)); console.log(JSON.stringify(out));"
ts = subprocess.run(['node', '--input-type=module', '-e', source], cwd=ROOT, capture_output=True, text=True, encoding='utf-8', check=True)
for case, actual in zip(read(ROOT/'conformance/vectors/llm/openai-context-0.1.json')['cases'], json.loads(ts.stdout), strict=True):
    py = run_provider(case)
    assert py == actual, (case['id'], py, actual)
    for k, v in case['expected'].items():
        assert actual[k] == v, (case['id'], k, actual)
print('12 opt-in context provider cases agree, including default rejection, role preservation and tool-pair boundaries.')
