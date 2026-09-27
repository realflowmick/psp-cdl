# SPDX-License-Identifier: Apache-2.0
"""Offline synthetic pilot contracts, two-way CLI interchange and full allocation."""
import json
import subprocess
import sys
import uuid
from pathlib import Path

from psp_cdl_core import canonical_json
from psp_cdl_test_harness import create_pilot_plan, analyze_pilot, pilot_digest
from pilot_fixtures import SUITE, fixture_outcomes, run_case

ROOT = Path(__file__).resolve().parents[1]
RUN = ROOT/'.artifacts'/('pilot-parity-'+uuid.uuid4().hex[:10])
RUN.mkdir(parents=True)


def run(args, expected=0):
    result = subprocess.run(args,cwd=ROOT,capture_output=True,text=True,encoding='utf-8')
    if result.returncode != expected:
        raise AssertionError(f'Pilot command returned {result.returncode}, expected {expected}: {result.stdout} {result.stderr}')
    return json.loads(result.stdout)


node_cases = """
import {readFileSync} from 'node:fs';
import {runCase} from './scripts/pilot-fixtures.mjs';
const suite=JSON.parse(readFileSync('conformance/vectors/evaluation/pilot-0.1.json','utf8'));
console.log(JSON.stringify(suite.cases.map(runCase)));
"""
actual = run(['node','--input-type=module','-e',node_cases])
expected = [run_case(case) for case in SUITE['cases']]
assert actual == expected, 'Pilot vector results differ across languages'
assert [r['code'] for r in actual] == [c['code'] for c in SUITE['cases']]

# Exercise the complete proposed allocation and 10,000 resamples. These labels
# are deliberately public synthetic fixtures, not a held-out corpus or study.
request_path = ROOT/'conformance/vectors/evaluation/pilot-request-0.1.json'
request = json.loads(request_path.read_text(encoding='utf-8'))
commands = {'typescript':['node','scripts/pilot.mjs'], 'python':[sys.executable,'scripts/pilot.py']}
plans = {}
for language, command in commands.items():
    path = RUN/(language+'-plan.json')
    summary = run([*command,'plan','--request',str(request_path),'--output',str(path)])
    plans[language] = json.loads(path.read_text(encoding='utf-8'))
    assert summary['sha256'] == pilot_digest(plans[language])
    assert summary['executionAuthorized'] is False
assert (RUN/'typescript-plan.json').read_bytes() == (RUN/'python-plan.json').read_bytes()
assert plans['python'] == create_pilot_plan(request)
assert len(plans['python']['trials']) == 1920

analyses = {}
for language, command in commands.items():
    peer = 'python' if language == 'typescript' else 'typescript'
    outcomes = fixture_outcomes(plans[peer],'varying-clusters')
    outcomes_path = RUN/(language+'-outcomes.json')
    outcomes_path.write_bytes((canonical_json(outcomes)+'\n').encode('utf-8'))
    path = RUN/(language+'-analysis.json')
    args = [*command,'analyze','--plan',str(RUN/(peer+'-plan.json')),'--outcomes',str(outcomes_path),'--output',str(path)]
    summary = run(args)
    analyses[language] = json.loads(path.read_text(encoding='utf-8'))
    assert summary['sha256'] == pilot_digest(analyses[language])
    assert analyses[language]['bootstrapResamples'] == 10000
    assert analyses[language]['provenance'] == 'synthetic-fixture'
    assert analyses[language]['independentReview'] is False and analyses[language]['fullStudy'] is False
    assert all(g['clusters'] == 12 and g['planned'] == 480 for g in analyses[language]['groups'])
    # Existing outputs and paths outside ignored artifacts must stay untouched.
    before = path.read_bytes()
    assert run(args,2)['code'] == 'INVALID_INPUT_OR_OUTPUT'
    assert path.read_bytes() == before
    assert run([*command,'plan','--request',str(request_path),'--output',str(ROOT/'pilot-forbidden.json')],2)['code'] == 'INVALID_INPUT_OR_OUTPUT'
    assert not (ROOT/'pilot-forbidden.json').exists()
assert (RUN/'typescript-analysis.json').read_bytes() == (RUN/'python-analysis.json').read_bytes()
assert analyses['python'] == analyze_pilot(plans['python'],outcomes)

# Validate the actual exchanged output against the shared JSON Schema.
run(['node','--input-type=module','-e',"""
import {readFileSync} from 'node:fs';
import {validatePilot} from './scripts/validate-pilot.mjs';
const folder=process.argv[1];
for(const language of ['typescript','python'])for(const kind of ['plan','outcomes','analysis'])
  validatePilot(kind,JSON.parse(readFileSync(folder+'/'+language+'-'+kind+'.json','utf8')));
console.log(JSON.stringify({valid:true}));
""",str(RUN)])
report = {'scope':'synthetic-pilot-validation','cases':len(SUITE['cases']),'trials':1920,'bootstrapResamples':10000,
          'twoWayInterchange':True,'planSha256':pilot_digest(plans['python']),
          'analysisSha256':pilot_digest(analyses['python']),'executionAuthorized':False,'fullStudy':False}
(RUN/'validation.json').write_bytes((canonical_json(report)+'\n').encode('utf-8'))
print(json.dumps(report))
