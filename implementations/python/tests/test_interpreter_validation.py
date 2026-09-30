# SPDX-License-Identifier: Apache-2.0
from copy import deepcopy
import hashlib
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[3]/'scripts'))
from context_service_fixtures import run_case, CONFIGURATION
from interpreter_validation import grade_case
from provider_fixtures import run_case as run_provider
import joint_interpreter as runner

ROOT = runner.ROOT
SUITE = runner.read(ROOT/runner.SUITE)
CONFIG = {**CONFIGURATION, 'application': (ROOT/'examples/in-context/validation/application.psp').read_text(encoding='utf-8')}


class InterpreterValidationTests(unittest.TestCase):
    def test_context_provider_mapping_and_rejections(self):
        for case in runner.read(ROOT/'conformance/vectors/llm/openai-context-0.1.json')['cases']:
            with self.subTest(case=case['id']):
                actual = run_provider(case)
                for k, v in case['expected'].items():
                    self.assertEqual(actual[k], v, actual)
                if case['id'] == 'context-text-preserved':
                    self.assertEqual(actual['requests'][0]['messages'], case['settings']['request']['messages'])

    def test_shared_runtime_cases_and_negative_grades(self):
        for case in SUITE['cases']:
            with self.subTest(case=case['id']):
                actual = run_case(case, configuration=CONFIG, capture=True)
                observation = {'mode': 'rehearsal', 'actual': actual}
                grade = grade_case(case, observation)
                self.assertEqual(grade['boundaryStatus'], 'passed', grade)
                self.assertEqual(grade['behaviorStatus'], 'not-run')
                self.assertEqual(grade_case(case, {**observation, 'mode': 'live'})['behaviorStatus'], 'needs-review')
                requests = json.dumps([t['request'] for t in actual['trace']])
                for rubric in case['rubric']:
                    self.assertNotIn(rubric, requests)
                for field, value in [('node', 'invented'), ('version', 999), ('privateLeak', True), ('trace', [])]:
                    bad = deepcopy(observation)
                    bad['actual'][field] = value
                    self.assertEqual(grade_case(case, bad)['boundaryStatus'], 'failed')

    def test_external_provider_is_not_replaced_with_rehearsal_responses(self):
        case = SUITE['cases'][0]
        provider = {'id': 'isolated-provider', 'revision': '1', 'complete': True,
                    'sources': [{'id': 'synthetic', 'capabilities': []}],
                    'invoke': lambda *_: {'type': 'final', 'text': '{"type":"answer","text":"No write requested."}'}}
        actual = run_case(case, configuration=CONFIG, provider=provider, capture=True)
        self.assertEqual((actual['calls'], actual['version'], actual['node']), (1, 1, 'entry'))
        self.assertEqual(grade_case(case, {'mode': 'live', 'actual': actual})['boundaryStatus'], 'failed')

    def test_inventory_never_upgrades_original_scenarios(self):
        rows = runner.inventory([c['id'] for c in SUITE['cases']])
        self.assertEqual(len(rows), 68)
        self.assertEqual({r['scenarioStatus'] for r in rows}, {'not-run'})
        self.assertTrue(any(r['coverage'] == 'not-wired' for r in rows))

    def test_live_admission_rejects_before_worker_or_output(self):
        bundle = {'provider': {'complete': True, 'sources': [{'id': 'host', 'capabilities': []}]}}
        with patch.object(runner, 'read', return_value=bundle), patch.object(runner, 'verify_bundle'), patch.object(runner, 'worker') as worker:
            for allowed, digest in [(False, runner.digest(bundle)), (True, '0'*64), (False, None)]:
                with self.assertRaisesRegex(ValueError, 'LIVE_NOT_ADMITTED'):
                    runner.run('unused', 'unused', 'live', 'python', allowed, digest)
            worker.assert_not_called()

    def test_source_inventory_cannot_be_dropped_or_changed(self):
        bundle = {'sources': [{'path': 'a', 'sha256': 'b'}]}
        with patch.object(runner, 'validate'), patch.object(runner, 'pins', return_value=[]):
            with self.assertRaisesRegex(ValueError, 'SOURCE_DRIFT'):
                runner.verify_bundle(bundle)

    def test_rehearsal_cannot_be_semantically_promoted(self):
        with tempfile.TemporaryDirectory() as temp:
            directory = Path(temp)
            report = {'mode': 'rehearsal', 'status': 'rehearsal-passed'}
            runner.write_new(directory/'report.json', report)
            decision = {'reportSha256': hashlib.sha256((directory/'report.json').read_bytes()).hexdigest()}
            runner.write_new(directory/'review.json', decision)
            with patch.object(runner, 'validate'):
                with self.assertRaisesRegex(ValueError, 'NOT_REVIEWABLE_MODEL_EVIDENCE'):
                    runner.review(directory, directory/'review.json')

    def test_duplicate_json_keys_reject(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp)/'duplicate.json'
            path.write_text('{"mode":"rehearsal","mode":"live"}')
            with self.assertRaisesRegex(ValueError, 'DUPLICATE_KEY'):
                runner.read(path)

    def test_review_binds_actual_evidence_and_cannot_override_failures(self):
        case = SUITE['cases'][0]
        actual = run_case(case, configuration=CONFIG, capture=True)
        # Simulated live label exercises the recorder only; never exported as model evidence.
        observation = {'profile': runner.PROFILE, 'caseId': case['id'], 'mode': 'live', 'language': 'python', 'usage': [], 'actual': actual}
        with tempfile.TemporaryDirectory() as temp, patch.object(runner, 'validate'), patch.object(runner, 'verify_bundle'):
            directory = Path(temp)
            bundle = {'cases': [case['id']]}
            runner.write_new(directory/'bundle.json', bundle)
            evidence = directory/(case['id']+'.json')
            runner.write_new(evidence, observation)
            row = {**grade_case(case, observation), 'evidence': evidence.name,
                   'evidenceSha256': hashlib.sha256(evidence.read_bytes()).hexdigest()}
            report = {'mode': 'live', 'language': 'python', 'status': 'needs-review',
                      'bundleDigest': runner.digest(bundle), 'cases': [row]}
            runner.write_new(directory/'report.json', report)
            decision = {'reportSha256': hashlib.sha256((directory/'report.json').read_bytes()).hexdigest(),
                        'reviewer': 'synthetic-reviewer', 'decisions': [{'caseId': case['id'], 'verdict': 'pass',
                            'rationale': 'Recorder unit test only.', 'evidence': [{'collection': 'trace', 'index': 0}]}]}
            review = directory/'review.json'
            bad = deepcopy(decision)
            bad['decisions'][0]['evidence'][0]['index'] = 999
            runner.write_new(review, bad)
            with self.assertRaisesRegex(ValueError, 'INVALID_EVIDENCE_REFERENCE'):
                runner.review(directory, review)
            review.write_bytes(runner.encoded(decision))
            evidence.write_bytes(runner.encoded({**observation, 'usage': [{'tampered': True}]}))
            with self.assertRaisesRegex(ValueError, 'EVIDENCE_CHANGED'):
                runner.review(directory, review)
            evidence.write_bytes(runner.encoded(observation))
            self.assertEqual(runner.review(directory, review)['status'], 'review-recorded')
            self.assertEqual(runner.read(directory/'semantic-review.json')['reviewer'], 'synthetic-reviewer')

    def test_incomplete_provider_does_not_start_live_worker(self):
        bundle = {'provider': {'complete': False, 'sources': []}}
        with patch.object(runner, 'read', return_value=bundle), patch.object(runner, 'verify_bundle'), patch.object(runner, 'worker') as worker:
            with self.assertRaisesRegex(ValueError, 'PROVIDER_NOT_REVIEWED'):
                runner.run('unused', 'unused', 'live', 'python', True, runner.digest(bundle))
            worker.assert_not_called()
