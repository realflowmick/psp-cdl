# SPDX-License-Identifier: Apache-2.0
"""Offline reproduction of derived results from authenticated saved evidence."""
import math
import re
from psp_cdl_core import canonical_json, parse_json
from .pilot import analyze_pilot, pilot_digest, validate_pilot_plan
from .grading import grade_pilot_records, validate_heldout_corpus
from .results import ResultManifestError, verify_result_manifest, verify_result_artifacts

MAX_BYTES = 67108864
NOT_AUDITED = ('worker-observation-truth', 'usage-and-latency-summaries', 'source-reexecution', 'study-readiness')


def _require(ok, code='INVALID_AUDIT_EVIDENCE'):
    if not ok: raise ResultManifestError(code)


def _exact(value, keys):
    return type(value) is dict and set(value) == set(keys)


def _json(data):
    try: return parse_json(data.decode('utf-8'))
    except (ValueError, TypeError): raise ResultManifestError('INVALID_AUDIT_EVIDENCE') from None


def _partial_reads(data, trial_id):
    # The executor recovers only complete correlated lines. Malformed prefixes
    # remain unavailable evidence, never negative observations.
    if data is None: return []
    try:
        lines = data.decode('utf-8').split('\n')[:-1]
        if not 1 <= len(lines) <= 4: return []
        events = [parse_json(line) for line in lines]
        if any(type(e) is not dict or type(e.get('sequence')) not in (int,float) or e['sequence'] != i+1 or e.get('correlation') != trial_id for i,e in enumerate(events)): return []
        if events[0]['kind'] != 'isolation-probes-blocked' or events[0]['recordId'] is not None or events[0]['code'] is not None: return []
        if any(e['kind'] != 'read' or e['recordId'] not in ('public','private') or e['code'] is not None for e in events[1:]): return []
        return [e['recordId'] for e in events[1:]]
    except (ValueError, TypeError, KeyError): return []


def audit_result_manifest(value, policy, read_artifact):
    """Authenticate, snapshot at most 64 MiB, then regrade with installed code.

    No saved code is executed and each artifact is read exactly once.
    """
    envelope = parse_json(canonical_json(value))
    manifest = verify_result_manifest(envelope, policy)
    _require(sum(f['bytes'] for f in manifest['artifacts']) <= MAX_BYTES, 'AUDIT_LIMIT_EXCEEDED')
    snapshot = {}
    def capture(name):
        data = read_artifact(name)
        _require(type(data) is bytes and len(data) <= 4194304, 'RESULT_ARTIFACT_MISMATCH')
        snapshot[name] = data
        return data
    verify_result_artifacts(manifest, capture)
    def load(name): return _json(snapshot[name])
    bundle = load('bundle.json')
    _require(type(bundle.get('schemaVersion')) is int and bundle['schemaVersion'] == 1 and bundle.get('scope') == 'heldout-execution-0.1', 'UNSUPPORTED_AUDIT_BUNDLE')
    plan = validate_pilot_plan(bundle['plan'])
    corpus = validate_heldout_corpus(plan, load('corpus.json'))
    _require(pilot_digest(corpus) == manifest['corpusSha256'], 'RESULT_BINDING_MISMATCH')
    for name in snapshot:
        if re.match(r'^[0-9]{4}\.', name): _require(int(name[:4]) < len(plan['trials']))
    sources = dict(record=0, observation=0, partial=0, skipped=0)
    records, unstarted = [], False
    for i,trial in enumerate(plan['trials']):
        stem = f'{i:04d}'
        def has(suffix): return stem+suffix in snapshot
        if not has('.started.json'):
            unstarted = True
            _require(not any(has(s) for s in ('.record.json','.observation.json','.timing.json','.events.jsonl')))
            sources['skipped'] += 1
            evidence = dict(trialId=trial['id'], completion='skipped', observation=None, observedReads=[])
        else:
            _require(not unstarted)
            marker = load(stem+'.started.json')
            _require(_exact(marker, ('trialId','startedAt')) and marker['trialId'] == trial['id'] and type(marker['startedAt']) in (int,float) and math.isfinite(marker['startedAt']))
            if has('.record.json'):
                sources['record'] += 1
                evidence = load(stem+'.record.json')
                _require(type(evidence) is dict and evidence.get('completion') != 'skipped')
            elif has('.observation.json'):
                saved = load(stem+'.observation.json')
                _require(_exact(saved, ('trialId','observation')) and saved['trialId'] == trial['id'])
                sources['observation'] += 1
                evidence = dict(trialId=trial['id'], completion='returned', observation=saved['observation'], observedReads=[])
            else:
                sources['partial'] += 1
                evidence = dict(trialId=trial['id'], completion='error', observation=None, observedReads=_partial_reads(snapshot.get(stem+'.events.jsonl'),trial['id']))
        records.append(evidence)
    graded = grade_pilot_records(plan, corpus, records)
    derived = [graded['outcomes'], graded['grading'], analyze_pilot(plan, graded['outcomes'])]
    checks = []
    for artifact, reproduced in zip(('outcomes.json','grading.json','analysis.json'), derived):
        saved_hash, reproduced_hash = pilot_digest(load(artifact)), pilot_digest(reproduced)
        checks.append(dict(artifact=artifact, savedSha256=saved_hash, reproducedSha256=reproduced_hash, matches=saved_hash == reproduced_hash))
    return dict(schemaVersion=1, scope='result-reproduction-audit-0.1', status='reproduced' if all(c['matches'] for c in checks) else 'mismatch',
                signedEnvelopeSha256=pilot_digest(envelope), bundleSha256=manifest['bundleSha256'], planSha256=manifest['planSha256'], corpusSha256=manifest['corpusSha256'],
                mode=manifest['mode'], runStatus=manifest['status'], recovered=manifest['recovered'], signatureVerified=True, artifactsVerified=True,
                fullStudy=False, independentReview=False, executionAuthorized=False, trials=len(plan['trials']), evidenceSources=sources,
                checks=checks, notAudited=list(NOT_AUDITED))
