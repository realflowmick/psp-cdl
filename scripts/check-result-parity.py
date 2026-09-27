# SPDX-License-Identifier: Apache-2.0
"""Shared signature vectors and both signing directions against actual executor evidence."""
import argparse
import base64
import hashlib
import json
import subprocess
import sys
import tempfile
import uuid
from pathlib import Path
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from cryptography.hazmat.primitives import serialization
from psp_cdl_test_harness import sign_result_manifest, result_signing_input
from result_fixtures import SUITE, run_result_case
from result_files import prepare_manifest
from audit_fixtures import SUITE as AUDIT_SUITE, run_audit_case

ROOT = Path(__file__).resolve().parents[1]


def call(args, expected=0, data=None):
    p = subprocess.run(args,cwd=ROOT,input=data,capture_output=True,text=True,encoding='utf-8')
    if p.returncode != expected: raise AssertionError(f'Unexpected command status {p.returncode}: {p.stdout} {p.stderr}')
    return json.loads(p.stdout)


def check(directory=None):
    subprocess.run([sys.executable,'scripts/generate-result-audit.py','--check'],cwd=ROOT,check=True,stdout=subprocess.DEVNULL)
    audits = call(['node','--input-type=module','-e',
        "import {suite,runAuditCase} from './scripts/audit-fixtures.mjs';console.log(JSON.stringify(suite.cases.map(runAuditCase)));"])
    assert audits == [run_audit_case(c) for c in AUDIT_SUITE['cases']]
    assert [r['code'] for r in audits] == [c['expectedCode'] for c in AUDIT_SUITE['cases']]
    subprocess.run([sys.executable,'scripts/generate-result-contract.py','--check'],cwd=ROOT,check=True,stdout=subprocess.DEVNULL)
    actual = call(['node','--input-type=module','-e',
        "import {suite,runResultCase} from './scripts/result-fixtures.mjs';console.log(JSON.stringify(suite.cases.map(runResultCase)));"])
    expected = [run_result_case(c) for c in SUITE['cases']]
    assert actual == expected
    assert [r['code'] for r in expected] == [c['code'] for c in SUITE['cases']]
    e = SUITE['envelope']
    actual = call(['node','--input-type=module','-e',
        "import {suite} from './scripts/result-fixtures.mjs';import {signResultManifest,resultSigningInput} from '@psp-cdl/test-harness';"
        "const e=suite.envelope;console.log(JSON.stringify({envelope:signResultManifest(e.manifest,e.signature.keyId,e.signature.signedAt,Buffer.from(suite.testKey.seedHex,'hex')),input:Buffer.from(resultSigningInput(e)).toString('hex')}));"])
    assert actual == {'envelope':sign_result_manifest(e['manifest'],e['signature']['keyId'],e['signature']['signedAt'],bytes.fromhex(SUITE['testKey']['seedHex'])),
                      'input':result_signing_input(e).hex()}
    if directory is None:
        print(json.dumps({'sharedResultCases':len(expected),'sharedAuditCases':len(audits),'canonicalBytesAndSignatures':True}))
        return
    directory = Path(directory).resolve()
    source = json.loads((directory/'manifest.json').read_text(encoding='utf-8'))
    output = ROOT/'.artifacts'/('result-parity-'+uuid.uuid4().hex[:10]);output.mkdir()
    # Temporary host keys never enter output, subprocess arguments or uploaded artifacts.
    with tempfile.TemporaryDirectory() as temp:
        key = Ed25519PrivateKey.generate()
        private = Path(temp)/'private.pem'
        private.write_bytes(key.private_bytes(serialization.Encoding.PEM,serialization.PrivateFormat.PKCS8,serialization.NoEncryption()))
        trust = Path(temp)/'trust.json'
        trust.write_text(json.dumps({'schemaVersion':1,'keyId':'ephemeral-parity','publicKey':base64.urlsafe_b64encode(key.public_key().public_bytes_raw()).decode().rstrip('='),
                                    'status':'active','bundleSha256':source['bundleSha256']}),encoding='utf-8')
        signed = output/'python-signed.json'
        sign_args = [sys.executable,'scripts/result-manifest.py','sign','--directory',str(directory),'--bundle-sha256',source['bundleSha256'],
                     '--key-id','ephemeral-parity','--private-key',str(private),'--output',str(signed)]
        signed_summary = call(sign_args)
        assert signed_summary['signatureVerified'] and signed_summary['artifactsVerified'] and not signed_summary['fullStudy']
        before = signed.read_bytes()
        assert call(sign_args,2)['status'] == 'rejected'
        assert signed.read_bytes() == before
        for command in ([sys.executable,'scripts/result-manifest.py'],['node','scripts/result-manifest.mjs']):
            summary = call([*command,'verify','--directory',str(directory),'--signed',str(signed),'--trust',str(trust)])
            assert summary == {**signed_summary,'status':'verified'}
        audit_args = ['audit','--directory',str(directory),'--signed',str(signed),'--trust',str(trust)]
        reports = [call([*command,*audit_args]) for command in ([sys.executable,'scripts/result-manifest.py'],['node','scripts/result-manifest.mjs'])]
        assert reports[0] == reports[1] and reports[0]['status'] == 'reproduced'
        assert reports[0]['evidenceSources'] == dict(record=96,observation=0,partial=0,skipped=0)
        (output/'audit.json').write_text(json.dumps(reports[0],indent=2)+'\n',encoding='utf-8')
        # Independent TS signing using a public fixture key, then Python CLI verification.
        ts_signed = output/'typescript-signed.json'
        m = prepare_manifest(directory,source['bundleSha256'])
        ts_envelope = call(['node','--input-type=module','-e',
            "import {readFileSync} from 'node:fs';import {signResultManifest} from '@psp-cdl/test-harness';"
            "import {suite} from './scripts/result-fixtures.mjs';console.log(JSON.stringify(signResultManifest(JSON.parse(readFileSync(0,'utf8')),suite.policy.keyId,suite.envelope.signature.signedAt,Buffer.from(suite.testKey.seedHex,'hex'))));"],data=json.dumps(m))
        ts_signed.write_text(json.dumps(ts_envelope),encoding='utf-8')
        fixture_trust = {**json.loads(trust.read_text()),'keyId':SUITE['policy']['keyId'],'publicKey':SUITE['testKey']['publicKey']}
        trust.write_text(json.dumps(fixture_trust),encoding='utf-8')
        args = ['verify','--directory',str(directory),'--signed',str(ts_signed),'--trust',str(trust)]
        assert call([sys.executable,'scripts/result-manifest.py',*args])['artifactsVerified']
        saved_signed = ts_signed.read_bytes()
        try:
            for malformed in (b'\xef\xbb\xbf'+saved_signed,b'{"manifest":{},"manifest":{}}'):
                ts_signed.write_bytes(malformed)
                for cmd in ([sys.executable,'scripts/result-manifest.py'],['node','scripts/result-manifest.mjs']):
                    assert call([*cmd,*args],2)['status'] == 'rejected'
        finally: ts_signed.write_bytes(saved_signed)
        # Exact-byte tampering, missing evidence, extra evidence and duplicate JSON names fail closed.
        target = directory/'outcomes.json';saved = target.read_bytes()
        try:
            target.write_bytes(saved+b'\n')
            for cmd in ([sys.executable,'scripts/result-manifest.py'],['node','scripts/result-manifest.mjs']):
                assert call([*cmd,*args],2)['code'] == 'RESULT_ARTIFACT_MISMATCH'
        finally: target.write_bytes(saved)
        extra = directory/'unlisted.json'
        try:
            extra.write_text('{}',encoding='utf-8')
            for cmd in ([sys.executable,'scripts/result-manifest.py'],['node','scripts/result-manifest.mjs']):
                assert call([*cmd,*args],2)['code'] == 'RESULT_DIRECTORY_MISMATCH'
        finally: extra.unlink()
        # A signer can authenticate incorrect derived labels. The audit must
        # report a calculation mismatch even though signature verification passes.
        source_path = directory/'manifest.json';source_bytes = source_path.read_bytes()
        saved_signature = ts_signed.read_bytes()
        try:
            changed = json.loads(saved);changed['schemaVersion'] = 99
            target.write_text(json.dumps(changed),encoding='utf-8')
            changed_source = json.loads(source_bytes)
            for f in changed_source['files']:
                if f['path'] == 'outcomes.json': f['sha256'] = hashlib.sha256(target.read_bytes()).hexdigest()
            source_path.write_text(json.dumps(changed_source),encoding='utf-8')
            resigned = sign_result_manifest(prepare_manifest(directory,source['bundleSha256']),SUITE['policy']['keyId'],
                                           SUITE['envelope']['signature']['signedAt'],bytes.fromhex(SUITE['testKey']['seedHex']))
            ts_signed.write_text(json.dumps(resigned),encoding='utf-8')
            mismatches = []
            for cmd in ([sys.executable,'scripts/result-manifest.py'],['node','scripts/result-manifest.mjs']):
                assert call([*cmd,*args])['artifactsVerified']
                mismatches.append(call([*cmd,'audit',*args[1:]],1))
            assert mismatches[0] == mismatches[1]
            assert [c['artifact'] for c in mismatches[0]['checks'] if not c['matches']] == ['outcomes.json']
        finally:
            target.write_bytes(saved);source_path.write_bytes(source_bytes);ts_signed.write_bytes(saved_signature)
        wrong_trust = {**fixture_trust,'bundleSha256':'0'*64};trust.write_text(json.dumps(wrong_trust),encoding='utf-8')
        for cmd in ([sys.executable,'scripts/result-manifest.py'],['node','scripts/result-manifest.mjs']):
            assert call([*cmd,*args],2)['code'] == 'RESULT_SCOPE_MISMATCH'
    print(json.dumps({'sharedResultCases':len(expected),'sharedAuditCases':len(audits),'pairedReproductionAudit':True,'canonicalBytesAndSignatures':True,'actualExecutorArtifacts':len(m['artifacts']),
                      'signingDirections':2,'signatureIsStudyApproval':False}))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__);parser.add_argument('--directory',type=Path)
    check(parser.parse_args().directory)
