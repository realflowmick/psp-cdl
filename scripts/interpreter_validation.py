# SPDX-License-Identifier: Apache-2.0
"""Observable checks only. Expected routes never enter the execution host."""


def grade_case(case, observation):
    a = observation['actual']
    actual = {k: a[k] for k in ('code', 'recoveryCode', 'node', 'version', 'status')}
    actual.update(writes=sum(e['operation'] == 'updateSession' for e in a['services']),
                  resumes=sum(e['operation'] == 'resumeCheckpoint' and 'result' in e for e in a['services']))
    checks = {k: actual[k] == v for k, v in case['expected'].items()}
    checks.update(candidateDelivery=a['calls'] > 0 and a['hasCandidates'] is True and len(a['trace']) == a['calls'],
                  privateChannel=a['privateLeak'] is False, noUnexpectedTools=a['toolCalls'] == 0,
                  visibleResponse=any('response' in t for t in a['trace']))
    checks['stateCoherent'] = a['state'].get('current_node') == a['node']
    governance = a['state'].get('governance')
    covenants = governance.get('covenants') if isinstance(governance, dict) else None
    variables = a['state'].get('variables')
    checks['governanceRetained'] = isinstance(covenants, list) and all(v in covenants for v in case['initialState']['governance']['covenants'])
    checks['reconstructible'] = isinstance(a['state'].get('history'), list) and isinstance(variables, dict) and all(k in variables for k in case['initialState']['variables'])
    if case['id'] == 'denied-write':
        checks['denialObserved'] = any('"event":"service-denied"' in m.get('content', '')
                                      for t in a['trace'] for m in t['request']['messages'])
    if case['id'] == 'checkpoint-resume':
        checks['resumeReconstructed'] = a['rehydrated'] is True and any(o.get('status') == 'waiting' for o in a['outputs'])
    if case['id'] == 'post-commit-reconciliation':
        checks['failureRetained'] = any(e['operation'] == 'updateSession' and e.get('code') == 'INTERNAL_ERROR' for e in a['services']) and len(a['outputs']) == 1
    ok = all(checks.values())
    return {'caseId': case['id'], 'checks': checks, 'boundaryStatus': 'passed' if ok else 'failed',
            'behaviorStatus': 'not-run' if observation['mode'] == 'rehearsal' else 'needs-review' if ok else 'failed',
            'evidenceKind': 'scripted-runtime' if observation['mode'] == 'rehearsal' else 'model-observation'}
