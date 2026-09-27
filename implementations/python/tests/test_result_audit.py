# SPDX-License-Identifier: Apache-2.0
import json
import sys
import unittest
from pathlib import Path
from psp_cdl_test_harness import audit_result_manifest, sign_result_manifest, ResultManifestError

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0,str(ROOT/'scripts'))
from audit_fixtures import SUITE, KEY, audit_input, run_audit_case


class ResultAuditTests(unittest.TestCase):
    def test_shared_vectors(self):
        for case in SUITE['cases']:
            with self.subTest(case=case['id']):
                result = run_audit_case(case)
                self.assertEqual(result['code'],case['expectedCode'])
                if result['code'] != 'OK': continue
                report = result['report']
                self.assertEqual(report['status'],case['expectedStatus'])
                self.assertEqual([c['artifact'] for c in report['checks'] if not c['matches']],case.get('mismatches',[]))
                self.assertEqual(report['runStatus'],case.get('runStatus','finalized'))
                self.assertEqual(report['recovered'],case.get('recovered',False))
                self.assertEqual(report['trials'],96)
                expected = dict(record=0,observation=0,partial=0,skipped=96) if case['id']=='all-unstarted' else dict(record=2,observation=1,partial=3,skipped=90)
                self.assertEqual(report['evidenceSources'],expected)
                self.assertFalse(report['executionAuthorized']);self.assertFalse(report['independentReview'])

    def test_authentication_precedes_io_and_files_are_read_once(self):
        envelope,policy,files = audit_input(SUITE['cases'][0]);seen = set();before = json.dumps(envelope)
        def reader(name):
            self.assertNotIn(name,seen);seen.add(name);return files[name]
        self.assertEqual(audit_result_manifest(envelope,policy,reader)['status'],'reproduced')
        self.assertEqual(seen,set(files));self.assertEqual(json.dumps(envelope),before)
        with self.assertRaisesRegex(ResultManifestError,'REVOKED_RESULT_KEY'):
            audit_result_manifest(envelope,{**policy,'status':'revoked'},lambda _:self.fail('reader called'))

    def test_snapshot_limit_precedes_io(self):
        envelope,policy,_ = audit_input(SUITE['cases'][0])
        for f in envelope['manifest']['artifacts']: f['bytes'] = 4194304
        signed = sign_result_manifest(envelope['manifest'],policy['keyId'],0,bytes.fromhex(KEY['seedHex']))
        with self.assertRaisesRegex(ResultManifestError,'AUDIT_LIMIT_EXCEEDED'):
            audit_result_manifest(signed,policy,lambda _:self.fail('reader called'))

    def test_partial_negative_effects_and_unknowns_are_retained_in_fixture(self):
        rows = json.loads(SUITE['files']['outcomes.json'])['rows']
        self.assertEqual(rows[1]['status'],'cancelled')
        self.assertEqual(rows[3]['status'],'error')
        details = json.loads(SUITE['files']['grading.json'])['details']
        self.assertTrue(any(d['unauthorizedRead'] is True for d in details))
        for row in rows[4:]:
            self.assertIsNone(row['attackSuccess']);self.assertIsNone(row['benignSuccess']);self.assertIsNone(row['falseDenial'])
