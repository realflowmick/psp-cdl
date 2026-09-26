# SPDX-License-Identifier: Apache-2.0
"""Strict observation grading and complete inventory accounting, outside the adapters."""
import hashlib
import json
from collections import Counter

LANGUAGES = ('typescript','python')
STATUSES = ('passed','failed','blocked','unsupported','skipped','error')


def digest(data): return hashlib.sha256(data).hexdigest()


def combinations():
    return [(t,h,p,s) for t in ('A','B','C') for h in LANGUAGES
            for p in (LANGUAGES if t == 'C' else (None,)) for s in LANGUAGES]


def validate_inputs(suite, inventory, mappings):
    cases = {c['id']:c for c in suite['cases']}
    requirements = {r['id']:r for r in inventory['requirements']}
    if len(cases) != len(suite['cases']) or len(requirements) != len(inventory['requirements']): raise ValueError('Duplicate input IDs')
    if sorted(c['seed'] for c in suite['cases'] if c['seed']) != ['CDL-001','CDL-002','PSP-001','PSP-002','PSP-003']: raise ValueError('Seed coverage missing')
    required = {'tenant-substitution','stale-state','replay-old-prompt','cancel-before-dispatch','cancel-after-read','bypass-export-control',
                'proxy-affinity-denial','proxy-policy-denial','server-output-denial','inference-denial','display-denial','tampered-prompt','expired-prompt'}
    if not required <= cases.keys(): raise ValueError('Required boundary controls missing')
    for c in suite['cases']:
        for t in ('A','B','C'):
            if (c['expected'][t] is None) != (t in c['unavailable']): raise ValueError('Invalid applicability disposition')
    seen = set()
    for mapping in mappings['mappings']:
        if not mapping['requirements'] or not mapping['cases'] or not mapping['remaining']: raise ValueError('Empty coverage mapping')
        for r in mapping['requirements']:
            if r not in requirements or r in seen: raise ValueError('Unknown or repeated requirement mapping')
            seen.add(r)
        for reference in mapping['cases']:
            if reference['id'] not in cases or not reference['topologies']: raise ValueError('Unknown workflow evidence')
            for t in reference['topologies']:
                if t not in ('A','B','C') or cases[reference['id']]['expected'][t] is None: raise ValueError('Unavailable workflow evidence')


def index_observations(entries, cases, topology):
    ids = {c['id'] for c in cases if c['expected'][topology] is not None}
    if not isinstance(entries,list) or len(entries) != len(ids): return None
    result = {}
    for entry in entries:
        if not isinstance(entry,dict) or entry.get('id') not in ids or entry['id'] in result: return None
        if set(entry) not in ({'id','observation'},{'id','error'}): return None
        if 'error' in entry and entry['error'] != 'ADAPTER_ERROR': return None
        result[entry['id']] = entry
    return result


def grade(expected, entry):
    if entry is None or 'error' in entry: return 'error','Adapter execution or observation validation failed.',None
    observed = entry['observation']
    equal = json.dumps(observed,sort_keys=True,separators=(',',':')) == json.dumps(expected,sort_keys=True,separators=(',',':'))
    return ('passed' if equal else 'failed'),('Exact decisions, effects and output match.' if equal else 'Observed decisions, effects or output differ.'),observed


def requirement_coverage(inventory, mappings, cells, commit, profile):
    index = {r:m for m in mappings['mappings'] for r in m['requirements']}
    entries = []
    counts = Counter()
    for requirement in inventory['requirements']:
        r = requirement['id']
        mapping = index.get(r)
        references = {(c['id'],t) for c in mapping['cases'] for t in c['topologies']} if mapping else set()
        linked = [c for c in cells if (c['result']['caseId'],c['topology']) in references]
        # Fixture passes never adopt a clause or overwrite the source inventory.
        status = 'blocked' if requirement['status'] == 'blocked' else 'unsupported'
        rationale = ('Normative blockers: '+', '.join(requirement['blockedBy'])) if status == 'blocked' else 'No reviewed clause-complete workflow assertion; source status remains unimplemented.'
        results = []
        for language in LANGUAGES:
            evidence = [rationale]
            if mapping: evidence += [mapping['scope'],mapping['remaining']]
            evidence += ['workflow:'+c['cellId']+':'+c['result']['status'] for c in linked if c['result']['implementation'] == language]
            results.append({'caseId':r,'implementation':language,'commit':commit,'profile':profile,'status':status,'evidence':evidence})
            counts[status] += 1
        entries.append({'requirementId':r,'sourceStatus':requirement['status'],'blockedBy':requirement['blockedBy'],
            'workflowCellIds':[c['cellId'] for c in linked],'results':results})
    return {'scope':'partial workflow evidence; whole-clause dispositions retained','totalRequirements':len(entries),'mappedRequirements':len(index),
        'requirementsWithPassingEvidence':sum(any(c['result']['status'] == 'passed' and c['cellId'] in e['workflowCellIds'] for c in cells) for e in entries),
        'summary':{s:counts[s] for s in STATUSES},'entries':entries}


def assemble(suite, inventory, mappings, provenance, observations, unavailable=None, selected=None):
    validate_inputs(suite,inventory,mappings)
    unavailable = unavailable or {}
    if selected is None: selected = set(combinations())
    cells = []
    expected_runs = 0
    for combination in combinations():
        topology, host, proxy, peer = combination
        for case in suite['cases']:
            applicable = case['expected'][topology] is not None
            expected_runs += applicable
            observation = None
            if not applicable: status,reason = 'unsupported',case['unavailable'][topology]
            elif combination not in selected: status,reason = 'skipped','Combination omitted by the operator.'
            elif combination in unavailable: status,reason = 'unsupported',unavailable[combination]
            else:
                entries = observations.get(combination)
                status,reason,observation = grade(case['expected'][topology],entries.get(case['id']) if entries else None)
            variant = 'bypass-control' if case['kind'] == 'bypass' else 'unmediated-control' if topology == 'A' else 'mediated'
            points = []
            if observation is not None:
                if variant == 'mediated': points = ['host-inference','host-dispatch','host-output']
                if topology == 'C': points += (['mcp-proxy-dispatch'] if variant == 'mediated' else [])+['server-output']
            cell_id = '/'.join([topology,host,proxy or 'none',peer,case['id']])
            cells.append({'cellId':cell_id,'topology':topology,'proxyImplementation':proxy,'peerImplementation':peer,'applicable':applicable,
                'variant':variant,'seed':case['seed'],'enforcementPoints':points,
                'result':{'caseId':case['id'],'implementation':host,'commit':provenance['commit'],'profile':suite['profile'],'status':status,
                    'evidence':[reason,'conformance/vectors/topologies/matrix-0.2.json#'+case['id']]},'observation':observation})
    counts = Counter(c['result']['status'] for c in cells)
    coverage = requirement_coverage(inventory,mappings,cells,provenance['commit'],suite['profile'])
    return {'schemaVersion':2,'profile':suite['profile'],'scope':'offline-workflow-topology-fixtures','fullConformance':False,**provenance,
        'configuration':suite['configuration'],'summary':{s:counts[s] for s in STATUSES},'requirements':coverage,
        'scopePassed':expected_runs > 0 and counts['passed'] == expected_runs and not any(counts[s] for s in ('failed','error','skipped')),'cells':cells}


def exit_code(report, check=False):
    if report['summary']['failed'] or report['summary']['error']: return 1
    if check and report['scopePassed']: return 0
    # A scoped fixture run never promotes pending whole-RFC clauses to conformance.
    return 2


def validate_report(suite, inventory, mappings, report):
    """Verify totals, exact case set, graded observations and inventory references."""
    expected_ids = {'/'.join([t,h,p or 'none',s,c['id']]) for t,h,p,s in combinations() for c in suite['cases']}
    cells = report['cells']
    if len(cells) != len(expected_ids) or {c['cellId'] for c in cells} != expected_ids: raise ValueError('Incomplete matrix')
    cases = {c['id']:c for c in suite['cases']}
    for cell in cells:
        result = cell['result']
        identity = '/'.join([cell['topology'],result['implementation'],cell['proxyImplementation'] or 'none',cell['peerImplementation'],result['caseId']])
        if identity != cell['cellId']: raise ValueError('Cell identity mismatch')
        expected = cases[result['caseId']]['expected'][cell['topology']]
        if result['commit'] != report['commit'] or result['profile'] != suite['profile']: raise ValueError('Result provenance mismatch')
        if cell['applicable'] != (expected is not None): raise ValueError('Invalid applicability')
        if result['status'] in ('passed','failed'):
            if expected is None or grade(expected,{'observation':cell['observation']})[0] != result['status']: raise ValueError('Incorrect grade')
        elif cell['observation'] is not None: raise ValueError('Unexecuted observation')
    counts = Counter(c['result']['status'] for c in cells)
    if report['summary'] != {s:counts[s] for s in STATUSES}: raise ValueError('Incorrect totals')
    runs = sum(c['applicable'] for c in cells)
    if report['scopePassed'] != (runs > 0 and counts['passed'] == runs and not any(counts[s] for s in ('failed','error','skipped'))): raise ValueError('Incorrect scope claim')
    if report['fullConformance'] is not False: raise ValueError('Unsupported conformance claim')
    if report['requirements'] != requirement_coverage(inventory,mappings,cells,report['commit'],suite['profile']): raise ValueError('Incomplete or overstated requirement evidence')
