# SPDX-License-Identifier: Apache-2.0
import base64
import json
import hashlib
from copy import deepcopy
from pathlib import Path
from psp_cdl_test_harness import sign_result_manifest, verify_result_manifest, verify_result_artifacts

SUITE = json.loads((Path(__file__).resolve().parents[1]/'conformance/vectors/evaluation/result-manifest-0.1.json').read_text(encoding='utf-8'))


def run_result_case(case):
    data = deepcopy({k:SUITE[k] for k in ('envelope','policy','files')})
    if case['target']:
        target = data[case['target']]
        for part in case['path'][:-1]: target = target[part]
        if case['delete']: del target[case['path'][-1]]
        else: target[case['path'][-1]] = deepcopy(case['value'])
    if case.get('matchingKeyId'): data['policy']['keyId'] = data['envelope']['signature']['keyId']
    if case.get('rehashArtifact'):
        name = case['rehashArtifact'];raw = data['files'][name].encode('utf-8')
        entry = next(f for f in data['envelope']['manifest']['artifacts'] if f['path'] == name)
        entry.update(bytes=len(raw),sha256=hashlib.sha256(raw).hexdigest())
    if case['resign']:
        e = data['envelope']
        data['envelope'] = sign_result_manifest(e['manifest'],e['signature']['keyId'],e['signature']['signedAt'],bytes.fromhex(SUITE['testKey']['seedHex']))
    data['policy']['publicKey'] = base64.urlsafe_b64decode(data['policy']['publicKey']+'==')
    try:
        manifest = verify_result_manifest(data['envelope'],data['policy'])
        verify_result_artifacts(manifest,lambda name:data['files'][name].encode('utf-8'))
        return {'code':'OK','manifest':manifest}
    except ValueError as error:
        return {'code':getattr(error,'code','UNEXPECTED_ERROR')}
