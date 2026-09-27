# SPDX-License-Identifier: Apache-2.0
"""Shared signature vectors and both signing directions against actual executor evidence."""
import argparse
import base64
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

ROOT = Path(__file__).resolve().parents[1]


def call(args, expected=0, data=None):
    p = subprocess.run(args,cwd=ROOT,input=data,capture_output=True,text=True,encoding='utf-8')
    if p.returncode != expected: raise AssertionError(f'Unexpected command status {p.returncode}: {p.stdout} {p.stderr}')
    return json.loads(p.stdout)


def check(directory=None):
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
        print(json.dumps({'sharedResultCases':len(expected),'canonicalBytesAndSignatures':True}))
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
        wrong_trust = {**fixture_trust,'bundleSha256':'0'*64};trust.write_text(json.dumps(wrong_trust),encoding='utf-8')
        for cmd in ([sys.executable,'scripts/result-manifest.py'],['node','scripts/result-manifest.mjs']):
            assert call([*cmd,*args],2)['code'] == 'RESULT_SCOPE_MISMATCH'
    print(json.dumps({'sharedResultCases':len(expected),'canonicalBytesAndSignatures':True,'actualExecutorArtifacts':len(m['artifacts']),
                      'signingDirections':2,'signatureIsStudyApproval':False}))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__);parser.add_argument('--directory',type=Path)
    check(parser.parse_args().directory)
