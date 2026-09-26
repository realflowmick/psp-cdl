# SPDX-License-Identifier: Apache-2.0
import json
from copy import deepcopy
from pathlib import Path
from psp_cdl_test_harness import create_pilot_plan, analyze_pilot, pilot_digest

ROOT = Path(__file__).resolve().parents[1]
SUITE = json.loads((ROOT/'conformance/vectors/evaluation/pilot-0.1.json').read_text(encoding='utf-8'))


def fixture_outcomes(plan, scenario='known-improvement'):
    rows = []
    for trial in plan['trials']:
        attack = trial['kind'] == 'attack'
        success = trial['condition'] != 'combined'
        if scenario == 'matched-clusters': success = trial['family'] == 'direct-read'
        if scenario == 'varying-clusters': success = success and trial['family'] == 'direct-read'
        if scenario == 'effect-before-error': success = trial['condition'] == 'combined'
        row = {'trialId':trial['id'],'status':'observed','attackSuccess':success if attack else None,
               'benignSuccess':None if attack else True,'falseDenial':None if attack else False}
        if scenario == 'all-unknown': row.update(status='error',attackSuccess=None,benignSuccess=None,falseDenial=None)
        if scenario == 'effect-before-error' and attack and success: row['status'] = 'error'
        rows.append(row)
    return {'schemaVersion':1,'planSha256':pilot_digest(plan),'provenance':plan['request']['manifest']['provenance'],'rows':rows}


def run_case(case):
    scenario, request = case['id'], deepcopy(SUITE['request'])
    try:
        if scenario == 'duplicate-case': request['manifest']['pairs'][1]['attackCaseId'] = request['manifest']['pairs'][0]['attackCaseId']
        if scenario == 'missing-family': request['manifest']['pairs'][1]['family'] = 'direct-read'
        if scenario == 'newline-identifier': request['manifest']['pairs'][0]['id'] += '\n'
        if scenario == 'boolean-seed': request['orderSeed'] = True
        if scenario == 'unknown-request-field': request['apiKey'] = 'rejected-synthetic'
        if scenario == 'trial-bound':
            request = json.loads((ROOT/'conformance/vectors/evaluation/pilot-request-0.1.json').read_text())
            request['repetitions'] = 20
        plan = create_pilot_plan(request)
        outcomes = fixture_outcomes(plan,scenario)
        rows = outcomes['rows']
        attack = next(r for t,r in zip(plan['trials'],rows) if t['kind'] == 'attack')
        benign = next(r for t,r in zip(plan['trials'],rows) if t['kind'] == 'benign')
        if scenario == 'missing-row': rows.pop()
        if scenario == 'duplicate-row': rows[-1] = deepcopy(rows[0])
        if scenario == 'reordered-rows': rows[0],rows[1] = rows[1],rows[0]
        if scenario == 'extra-row': rows.append(deepcopy(rows[0]))
        if scenario == 'wrong-plan-digest': outcomes['planSha256'] = '0'*64
        if scenario == 'wrong-provenance': outcomes['provenance'] = 'unreviewed-input'
        if scenario == 'extra-authority': rows[0]['approved'] = True
        if scenario == 'wrong-kind': attack['benignSuccess'] = True
        if scenario == 'error-as-defense': attack.update(status='error',attackSuccess=False)
        if scenario == 'skipped-as-success': attack.update(status='skipped',attackSuccess=True)
        if scenario == 'utility-denial-conflict': benign.update(benignSuccess=True,falseDenial=True)
        if scenario == 'changed-trial': plan['trials'][0]['caseId'] = 'changed'
        if scenario == 'rehashed-order':
            plan['trials'].reverse()
            plan['trialsSha256'] = pilot_digest(plan['trials'])
            outcomes = fixture_outcomes(plan,scenario)
        if scenario == 'execution-claim': plan['executionAuthorized'] = True
        return {'code':'OK','planSha256':pilot_digest(plan),'trialsSha256':plan['trialsSha256'],'trials':len(plan['trials']),
                'analysis':analyze_pilot(plan,outcomes)}
    except Exception as exc:
        return {'code':getattr(exc,'code','UNEXPECTED_ERROR')}
