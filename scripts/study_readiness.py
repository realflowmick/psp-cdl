# SPDX-License-Identifier: Apache-2.0
"""Structural evidence inventory only; never authorizes execution or claims independence."""
import hashlib
import json
import re
from pathlib import Path

EVIDENCE = frozenset(('held-out-corpus','held-out-executor-validation','analysis-validation','independent-grading',
                      'ordered-trial-plan','operator-live-admission','signed-result-manifest-contract','preregistration-decision'))


def inspect_candidate(candidate, root):
    root = Path(root).resolve()
    if type(candidate) is not dict or set(candidate) != {'schemaVersion','id','status','protocol','scope','evidence'} or type(candidate['schemaVersion']) is not int or candidate['schemaVersion'] != 1 or candidate['status'] != 'draft':
        raise ValueError('Invalid candidate envelope')
    if type(candidate['id']) is not str or not re.fullmatch(r'[a-z0-9-]+\.[0-9]+',candidate['id']): raise ValueError('Invalid candidate ID')
    scope = candidate['scope']
    expected = {'topology','conditions','hosts','peers','families','pairsPerFamily','repetitions','orderSeed','analysisSeed','bootstrapResamples'}
    if type(scope) is not dict or set(scope) != expected: raise ValueError('Invalid candidate scope')
    if scope['topology'] != 'B' or scope['conditions'] != ['unprotected','psp-only','cdl-only','combined'] or any(scope[k] != ['typescript','python'] for k in ('hosts','peers')):
        raise ValueError('Unsupported pilot configuration')
    if scope['families'] != ['direct-read','indirect-read','restricted-display']: raise ValueError('Unsupported pilot family')
    for key, maximum in (('pairsPerFamily',100),('repetitions',100),('orderSeed',2147483647),('analysisSeed',2147483647),('bootstrapResamples',100000)):
        if type(scope[key]) is not int or not 1 <= scope[key] <= maximum: raise ValueError('Invalid pilot allocation or seed')

    def artifact(path):
        if type(path) is not str or not path or '\\' in path or Path(path).is_absolute(): raise ValueError('Invalid evidence path')
        resolved = (root/path).resolve()
        if not resolved.is_relative_to(root): raise ValueError('Evidence outside repository')
        return resolved

    protocol = artifact(candidate['protocol'])
    if not protocol.is_file(): raise ValueError('Missing proposal protocol')
    entries = candidate['evidence']
    if type(entries) is not list or any(type(e) is not dict or set(e) != {'id','path','sha256'} or type(e['id']) is not str for e in entries):
        raise ValueError('Invalid evidence entries')
    if len(entries) != len(EVIDENCE) or {e['id'] for e in entries} != EVIDENCE: raise ValueError('Missing or duplicate evidence category')
    blockers, checked = [], []
    for entry in entries:
        if entry['path'] is None and entry['sha256'] is None:
            blockers.append({'id':entry['id'],'reason':'missing-evidence'})
            continue
        if type(entry['sha256']) is not str or not re.fullmatch('[a-f0-9]{64}',entry['sha256']): raise ValueError('Invalid evidence digest')
        path = artifact(entry['path'])
        if not path.is_file(): blockers.append({'id':entry['id'],'reason':'missing-file'})
        elif hashlib.sha256(path.read_bytes()).hexdigest() != entry['sha256']: blockers.append({'id':entry['id'],'reason':'digest-mismatch'})
        else: checked.append(entry['id'])
    pairs = len(scope['families'])*scope['pairsPerFamily']
    trials = pairs*2*scope['repetitions']*len(scope['conditions'])*len(scope['hosts'])*len(scope['peers'])
    return {'schemaVersion':1,'candidate':candidate['id'],'candidateSha256':hashlib.sha256(json.dumps(candidate,sort_keys=True,separators=(',',':')).encode()).hexdigest(),
            'protocolSha256':hashlib.sha256(protocol.read_bytes()).hexdigest(),
            'status':'incomplete' if blockers else 'ready-for-maintainer-review','executionAuthorized':False,'fullStudy':False,
            'casePairs':pairs,'plannedTrials':trials,'maximumProviderAttempts':trials*4,
            'verifiedArtifactHashes':checked,'blockers':blockers}
