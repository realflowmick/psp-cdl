# SPDX-License-Identifier: Apache-2.0
"""Offline pilot planning and exploratory paired-cluster analysis. No execution authority."""
import hashlib
import itertools
import re

from psp_cdl_core import canonical_json, parse_json

CONDITIONS = ('unprotected', 'psp-only', 'cdl-only', 'combined')
LANGUAGES = ('typescript', 'python')
FAMILIES = ('direct-read', 'indirect-read', 'restricted-display')
METRICS = ('attackSuccess', 'benignSuccess', 'falseDenial')
MAX_TRIALS = 4096


class PilotError(ValueError):
    def __init__(self, code):
        super().__init__(code)
        self.code = code


def _require(condition, code):
    if not condition:
        raise PilotError(code)


def _exact(value, keys):
    return type(value) is dict and set(value) == set(keys)


def _integer(value, minimum, maximum):
    return type(value) in (int, float) and minimum <= value <= maximum and value == int(value)


def _copy(value, code):
    try:
        return parse_json(canonical_json(value))
    except Exception:
        pass
    raise PilotError(code)


def pilot_digest(value):
    """SHA-256 of the shared core's UTF-8 RFC 8785 canonical JSON."""
    return hashlib.sha256(canonical_json(value).encode('utf-8')).hexdigest()


def create_pilot_plan(value):
    request = _copy(value, 'INVALID_REQUEST')
    _require(_exact(request, ('schemaVersion', 'manifest', 'pairsPerFamily', 'repetitions', 'orderSeed', 'analysisSeed', 'bootstrapResamples')),
             'INVALID_REQUEST')
    _require(type(request['schemaVersion']) is int and request['schemaVersion'] == 1, 'INVALID_REQUEST')
    for key, low, high in (('pairsPerFamily', 1, 8), ('repetitions', 1, 20), ('orderSeed', 1, 2147483647),
                           ('analysisSeed', 1, 2147483647), ('bootstrapResamples', 200, 10000)):
        _require(_integer(request[key], low, high), 'INVALID_REQUEST')
        request[key] = int(request[key])
    manifest = request['manifest']
    _require(_exact(manifest, ('provenance', 'pairs')) and manifest['provenance'] in ('synthetic-fixture', 'unreviewed-input')
             and type(manifest['pairs']) is list and len(manifest['pairs']) == 3 * request['pairsPerFamily'], 'INVALID_MANIFEST')
    pair_ids, case_ids = set(), set()
    for pair in manifest['pairs']:
        _require(_exact(pair, ('id', 'family', 'attackCaseId', 'benignCaseId')), 'INVALID_MANIFEST')
        _require(pair['family'] in FAMILIES, 'INVALID_MANIFEST')
        for key in ('id', 'attackCaseId', 'benignCaseId'):
            _require(type(pair[key]) is str and re.fullmatch('[a-z0-9][a-z0-9_-]{0,63}', pair[key]), 'INVALID_MANIFEST')
        _require(pair['id'] not in pair_ids and pair['attackCaseId'] not in case_ids and pair['benignCaseId'] not in case_ids
                 and pair['attackCaseId'] != pair['benignCaseId'], 'INVALID_MANIFEST')
        pair_ids.add(pair['id'])
        case_ids.update((pair['attackCaseId'], pair['benignCaseId']))
    for family in FAMILIES:
        _require(sum(p['family'] == family for p in manifest['pairs']) == request['pairsPerFamily'], 'INVALID_MANIFEST')
    count = len(pair_ids) * 2 * request['repetitions'] * 16
    _require(count <= MAX_TRIALS, 'LIMIT_EXCEEDED')
    manifest['pairs'].sort(key=lambda p: p['id'])
    trials = []
    for pair, kind, condition, host, peer, repeat in itertools.product(
            manifest['pairs'], ('attack', 'benign'), CONDITIONS, LANGUAGES, LANGUAGES, range(1, request['repetitions'] + 1)):
        case_id = pair['attackCaseId' if kind == 'attack' else 'benignCaseId']
        trials.append({'id':f'{case_id}/{condition}/{host}/{peer}/{repeat}', 'pairId':pair['id'], 'caseId':case_id,
                       'family':pair['family'], 'kind':kind, 'condition':condition, 'host':host, 'peer':peer, 'repeat':repeat, 'topology':'B'})
    # Hash-sort fixes the entire order before outcomes. This is not a provider seed.
    def order(trial):
        key = f"PSP-PILOT-ORDER-0.1\n{request['orderSeed']}\n{trial['id']}".encode('ascii')
        return hashlib.sha256(key).hexdigest(), trial['id']
    trials.sort(key=order)
    return {'schemaVersion':1, 'scope':'pilot-plan-0.1', 'status':'draft', 'executionAuthorized':False, 'fullStudy':False,
            'orderAlgorithm':'sha256-sort-0.1', 'request':request, 'requestSha256':pilot_digest(request),
            'trials':trials, 'trialsSha256':pilot_digest(trials)}


def validate_pilot_plan(value):
    plan = _copy(value, 'INVALID_PLAN')
    _require(type(plan) is dict and 'request' in plan, 'INVALID_PLAN')
    try:
        expected = create_pilot_plan(plan['request'])
    except PilotError:
        raise PilotError('INVALID_PLAN') from None
    _require(canonical_json(plan) == canonical_json(expected), 'INVALID_PLAN')
    return plan


def _validate_outcomes(plan, value):
    outcomes = _copy(value, 'INVALID_OUTCOMES')
    _require(_exact(outcomes, ('schemaVersion', 'planSha256', 'provenance', 'rows')) and type(outcomes['schemaVersion']) is int
             and outcomes['schemaVersion'] == 1 and outcomes['planSha256'] == pilot_digest(plan)
             and outcomes['provenance'] == plan['request']['manifest']['provenance'], 'INVALID_OUTCOMES')
    rows = outcomes['rows']
    _require(type(rows) is list and len(rows) == len(plan['trials']), 'INVALID_OUTCOMES')
    for trial, row in zip(plan['trials'], rows):
        _require(_exact(row, ('trialId', 'status', *METRICS)) and row['trialId'] == trial['id']
                 and row['status'] in ('observed', 'error', 'cancelled', 'skipped')
                 and all(row[k] is None or type(row[k]) is bool for k in METRICS), 'INVALID_OUTCOMES')
        if trial['kind'] == 'attack':
            _require(row['benignSuccess'] is None and row['falseDenial'] is None, 'INVALID_OUTCOMES')
            if row['status'] == 'observed':
                _require(type(row['attackSuccess']) is bool, 'INVALID_OUTCOMES')
            elif row['status'] == 'skipped':
                _require(row['attackSuccess'] is None, 'INVALID_OUTCOMES')
            else:
                _require(row['attackSuccess'] is None or row['attackSuccess'] is True, 'INVALID_OUTCOMES')
        else:
            _require(row['attackSuccess'] is None, 'INVALID_OUTCOMES')
            if row['status'] == 'observed':
                _require(type(row['benignSuccess']) is bool and type(row['falseDenial']) is bool
                         and not (row['benignSuccess'] and row['falseDenial']), 'INVALID_OUTCOMES')
            else:
                _require(row['benignSuccess'] is None and row['falseDenial'] is None, 'INVALID_OUTCOMES')
    return outcomes


def _draws(seed, count, resamples):
    # Uniform indices via SHA-256 counter words and rejection, shared by every contrast.
    counter, threshold = 0, 2**32 - 2**32 % count
    for _ in range(resamples):
        sample = []
        while len(sample) < count:
            message = f'PSP-PILOT-BOOTSTRAP-0.1\n{seed}\n{counter}'.encode('ascii')
            word = int.from_bytes(hashlib.sha256(message).digest()[:4], 'big')
            counter += 1
            if word < threshold:
                sample.append(word % count)
        yield sample


def _rate(values):
    yes = sum(v is True for v in values)
    no = sum(v is False for v in values)
    total = len(values)
    unknown = total - yes - no
    return {'true':yes, 'false':no, 'unknown':unknown, 'total':total, 'rateAmongKnown':yes/(yes+no) if yes+no else None,
            'lower':yes/total, 'upper':(yes+unknown)/total}


def _interval(values):
    values.sort()
    # Nearest-rank empirical 2.5th and 97.5th percentiles; no interpolation.
    low = values[(len(values) + 39)//40 - 1]
    high = values[(39*len(values) + 39)//40 - 1]
    return {'low':low, 'high':high, 'degenerate':values[0] == values[-1]}


def analyze_pilot(plan_value, outcomes_value):
    plan = validate_pilot_plan(plan_value)
    outcomes = _validate_outcomes(plan, outcomes_value)
    request = plan['request']
    pairs = request['manifest']['pairs']
    pair_ids = [p['id'] for p in pairs]
    draws = list(_draws(request['analysisSeed'], len(pairs), request['bootstrapResamples']))
    draw_hash = hashlib.sha256()
    for draw in draws:
        draw_hash.update((canonical_json(draw)+'\n').encode('ascii'))
    joined = list(zip(plan['trials'], outcomes['rows']))
    groups = []
    for host, peer in itertools.product(LANGUAGES, LANGUAGES):
        group_rows = [(t,r) for t,r in joined if t['host'] == host and t['peer'] == peer]
        def rates(rows):
            return [{'condition':condition, 'metrics':{metric:_rate([r[metric] for t,r in rows
                    if t['condition'] == condition and t['kind'] == ('attack' if metric == 'attackSuccess' else 'benign')])
                    for metric in METRICS}} for condition in CONDITIONS]
        condition_rates = rates(group_rows)
        counts = {c['condition']:c['metrics'] for c in condition_rates}
        contrasts = []
        for metric, control in itertools.product(METRICS, CONDITIONS[:-1]):
            kind = 'attack' if metric == 'attackSuccess' else 'benign'
            by_pair = {pid:{c:[] for c in ('combined',control)} for pid in pair_ids}
            for t,r in group_rows:
                if t['kind'] == kind and t['condition'] in ('combined',control):
                    by_pair[t['pairId']][t['condition']].append(r[metric])
            lower_counts, upper_counts = [], []
            for pid in pair_ids:
                a, b = (_rate(by_pair[pid][c]) for c in ('combined',control))
                lower_counts.append(a['true'] - b['true'] - b['unknown'])
                upper_counts.append(a['true'] + a['unknown'] - b['true'])
            denominator = len(pairs)*request['repetitions']
            a, b = counts['combined'][metric], counts[control][metric]
            contrasts.append({'metric':metric, 'treatment':'combined', 'control':control, 'clusters':len(pairs),
                              'knownDifference':a['rateAmongKnown']-b['rateAmongKnown'] if a['rateAmongKnown'] is not None and b['rateAmongKnown'] is not None else None,
                              'lower':sum(lower_counts)/denominator, 'upper':sum(upper_counts)/denominator,
                              'lowerBoundPercentile95':_interval([sum(lower_counts[i] for i in draw)/denominator for draw in draws]),
                              'upperBoundPercentile95':_interval([sum(upper_counts[i] for i in draw)/denominator for draw in draws])})
        groups.append({'host':host, 'peer':peer, 'planned':len(group_rows), 'clusters':len(pairs),
                       'statuses':{s:sum(r['status'] == s for _,r in group_rows) for s in ('observed','error','cancelled','skipped')},
                       'conditions':condition_rates, 'families':[{'family':f, 'conditions':rates([(t,r) for t,r in group_rows if t['family'] == f])} for f in FAMILIES],
                       'contrasts':contrasts})
    return {'schemaVersion':1, 'scope':'pilot-analysis-0.1', 'provenance':outcomes['provenance'], 'fullStudy':False,
            'independentReview':False, 'planSha256':pilot_digest(plan), 'outcomesSha256':pilot_digest(outcomes),
            'method':'paired-case-cluster-percentile-0.1', 'analysisSeed':request['analysisSeed'],
            'bootstrapResamples':request['bootstrapResamples'], 'resampleIndicesSha256':draw_hash.hexdigest(), 'groups':groups,
            'limitations':['Exploratory percentile intervals for each bound estimator; no simultaneous or multiplicity-adjusted coverage claim.',
                          'Whole case pairs are resampled; repeated calls and language pairs are not independent clusters.',
                          'Unreviewed input labels and hashes do not establish corpus provenance, grading independence or effectiveness.',
                          'Degenerate intervals and zero observed attacks do not establish zero risk. No family-level intervals.']}
