# SPDX-License-Identifier: Apache-2.0
import base64
import os
import sys
import tempfile
import unittest
from copy import deepcopy
from pathlib import Path
from unittest.mock import patch
from psp_cdl_core import parse_json
from psp_cdl_test_harness import sign_result_manifest, result_signing_input, verify_result_manifest, validate_result_manifest

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0,str(ROOT/'scripts'))
from result_fixtures import SUITE, run_result_case
from result_files import read_bytes, directory_reader, write_signed, trust_policy


class ResultTests(unittest.TestCase):
    def test_shared_vectors(self):
        for case in SUITE['cases']:
            with self.subTest(case=case['id']): self.assertEqual(run_result_case(case)['code'],case['code'])

    def test_bytes_signatures_and_key_order_match_oracle(self):
        e = SUITE['envelope']
        self.assertEqual(result_signing_input(e).hex(),SUITE['signingInputHex'])
        for manifest in (e['manifest'],dict(reversed(list(e['manifest'].items())))):
            self.assertEqual(sign_result_manifest(manifest,e['signature']['keyId'],e['signature']['signedAt'],bytes.fromhex(SUITE['testKey']['seedHex'])),e)

    def test_signature_only_verification_returns_copy(self):
        e = deepcopy(SUITE['envelope'])
        m = verify_result_manifest(e,{**SUITE['policy'],'publicKey':base64.urlsafe_b64decode(SUITE['policy']['publicKey']+'=')})
        m['status'] = 'invalid-source-changed'
        self.assertEqual(e,SUITE['envelope'])

    def test_strict_json_and_invalid_keys(self):
        with self.assertRaises(ValueError): parse_json('{"manifest":{},"manifest":{}}')
        for value in (float('nan'),float('inf'),9007199254740992,'\ud800'):
            manifest = deepcopy(SUITE['envelope']['manifest']);manifest['artifacts'][0]['bytes'] = value
            with self.assertRaises(ValueError): validate_result_manifest(manifest)
        for seed in (bytes(31),'secret',None):
            with self.assertRaises(ValueError): sign_result_manifest(SUITE['envelope']['manifest'],'test',0,seed)

    def test_files_reject_links_escape_and_oversize(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp);target = root/'analysis.json';target.write_bytes(b'test')
            with self.assertRaises(ValueError): read_bytes(target,3)
            _,reader = directory_reader(root)
            for name in ('../analysis.json',str(target),'NUL.json','file:stream','analysis.json\n'):
                with self.assertRaises(ValueError): reader(name)
            linked = root/'corpus.json'
            os.link(target,linked)
            with self.assertRaises(ValueError): reader('corpus.json')
            linked.unlink()
            try: linked.symlink_to(target)
            except OSError: return # Windows without symlink privilege still exercised hard-link rejection.
            with self.assertRaises(ValueError): reader('corpus.json')

    def test_exclusive_output_cannot_replace_evidence_or_escape_artifacts(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp);artifacts = root/'.artifacts';artifacts.mkdir();evidence = artifacts/'run';evidence.mkdir()
            with patch('result_files.ROOT',root):
                output = artifacts/'signed.json'
                write_signed(output,SUITE['envelope'],evidence)
                original = output.read_bytes()
                with self.assertRaises(FileExistsError): write_signed(output,SUITE['envelope'],evidence)
                for bad in (evidence/'signed.json',root/'outside.json'):
                    with self.assertRaises(ValueError): write_signed(bad,SUITE['envelope'],evidence)
                self.assertEqual(output.read_bytes(),original)

    def test_trust_record_never_accepts_embedded_key_or_noncanonical_encoding(self):
        trust = {'schemaVersion':1,**{k:SUITE['policy'][k] for k in ('keyId','publicKey','status','bundleSha256')}}
        self.assertEqual(len(trust_policy(trust,0)['publicKey']),32)
        for bad in ({**trust,'schemaVersion':True},{**trust,'publicKey':trust['publicKey']+'='},{**trust,'now':0}):
            with self.assertRaises(ValueError): trust_policy(bad,0)
