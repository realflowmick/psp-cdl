# SPDX-License-Identifier: Apache-2.0
"""Public synthetic audit inputs. The reused fixture seed is never a host key."""
import base64
import hashlib
import json
from pathlib import Path
from psp_cdl_core import canonical_json
from psp_cdl_test_harness import pilot_digest, sign_result_manifest, audit_result_manifest

BASE = Path(__file__).resolve().parents[1]/'conformance/vectors/evaluation'
SUITE = json.loads((BASE/'result-audit-0.1.json').read_text(encoding='utf-8'))
KEY = json.loads((BASE/'result-manifest-0.1.json').read_text(encoding='utf-8'))['testKey']


def audit_input(case):
    files = {**SUITE['files'],**case.get('patches',{})}
    files = {k:v.encode('utf-8') for k,v in files.items() if v is not None}
    bundle = json.loads(files['bundle.json'])
    bindings = dict(bundleSha256=pilot_digest(bundle),planSha256=bundle['planSha256'],corpusSha256=bundle['corpusSha256'],mode=bundle['mode'],
                    status=case.get('runStatus','finalized'),recovered=case.get('recovered',False))
    def descriptors(): return [dict(path=k,bytes=len(v),sha256=hashlib.sha256(v).hexdigest()) for k,v in sorted(files.items())]
    source = dict(schemaVersion=1,scope='heldout-execution-result-0.1',**bindings,signed=False,fullStudy=False,independentReview=False,
                  files=[{k:v for k,v in f.items() if k != 'bytes'} for f in descriptors()],**case.get('sourceSummary',{}))
    files['manifest.json'] = canonical_json(source).encode()
    manifest = dict(schemaVersion=1,scope='signed-result-manifest-0.1',**bindings,evidencePolicy='local-synthetic-raw-0.1',
                    fullStudy=False,independentReview=False,executionAuthorized=False,artifacts=descriptors())
    envelope = sign_result_manifest(manifest,'public-audit-fixture',0,bytes.fromhex(KEY['seedHex']))
    policy = dict(keyId='public-audit-fixture',publicKey=base64.urlsafe_b64decode(KEY['publicKey']+'='),status='active',bundleSha256=bindings['bundleSha256'],now=1)
    policy.update(case.get('policy',{}))
    if 'tamper' in case: files[case['tamper']] += b'\n'
    if 'missing' in case: del files[case['missing']]
    return envelope,policy,files


def run_audit_case(case):
    envelope,policy,files = audit_input(case)
    try: return dict(code='OK',report=audit_result_manifest(envelope,policy,files.__getitem__))
    except (ValueError,TypeError,KeyError) as error: return dict(code=getattr(error,'code','UNEXPECTED_ERROR'))
