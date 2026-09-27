# SPDX-License-Identifier: Apache-2.0
import importlib.util
import json
import sys
import tempfile
import unittest
from copy import deepcopy
from pathlib import Path
from unittest.mock import patch
from psp_cdl_test_harness import create_pilot_plan, analyze_pilot, pilot_digest

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0,str(ROOT/'scripts'))
from pilot_fixtures import SUITE, run_case, fixture_outcomes


class PilotTests(unittest.TestCase):
    def test_shared_analytical_and_rejection_vectors(self):
        for case in SUITE['cases']:
            with self.subTest(case=case['id']):
                actual = run_case(case)
                self.assertEqual(actual['code'],case['code'])
                if case['code'] == 'OK':
                    self.assertEqual(actual['trials'],192)
                    for group in actual['analysis']['groups']:
                        contrast = group['contrasts'][0]
                        self.assertEqual(contrast['lower'],case['lower'])
                        self.assertEqual(contrast['upper'],case['upper'])
                        self.assertEqual(contrast['lowerBoundPercentile95']['degenerate'],case['degenerate'])
                        if case['degenerate']:
                            for bound in ('lower','upper'):
                                self.assertEqual(contrast[bound+'BoundPercentile95']['low'],case[bound])
                                self.assertEqual(contrast[bound+'BoundPercentile95']['high'],case[bound])

    def test_order_is_complete_reproducible_and_independent_of_manifest_input_order(self):
        request = deepcopy(SUITE['request'])
        plan = create_pilot_plan(request)
        self.assertEqual(len({t['id'] for t in plan['trials']}),192)
        request['manifest']['pairs'].reverse()
        self.assertEqual(create_pilot_plan(request),plan)
        request['orderSeed'] += 1
        changed = create_pilot_plan(request)
        self.assertNotEqual(changed['trialsSha256'],plan['trialsSha256'])
        self.assertEqual({t['id'] for t in changed['trials']},{t['id'] for t in plan['trials']})
        self.assertFalse(plan['executionAuthorized'])

    def test_repeating_identical_observations_does_not_create_new_clusters(self):
        reports = []
        for repetitions in (1,5):
            plan = create_pilot_plan({**SUITE['request'],'repetitions':repetitions})
            reports.append(analyze_pilot(plan,fixture_outcomes(plan,'varying-clusters')))
        self.assertEqual(reports[0]['resampleIndicesSha256'],reports[1]['resampleIndicesSha256'])
        self.assertEqual([g['contrasts'] for g in reports[0]['groups']],[g['contrasts'] for g in reports[1]['groups']])

    def test_unknowns_and_skips_preserve_denominators_and_positive_effects(self):
        plan = create_pilot_plan(SUITE['request'])
        outcomes = fixture_outcomes(plan,'all-unknown')
        for row in outcomes['rows']: row['status'] = 'skipped'
        report = analyze_pilot(plan,outcomes)
        group = report['groups'][0]
        self.assertEqual(group['statuses']['skipped'],group['planned'])
        for condition in group['conditions']:
            for value in condition['metrics'].values():
                self.assertEqual(value['unknown'],value['total'])
                self.assertEqual((value['lower'],value['upper']),(0,1))
                self.assertIsNone(value['rateAmongKnown'])
        self.assertFalse(report['independentReview'])
        self.assertFalse(report['fullStudy'])

    def test_separate_language_groups_do_not_pool_a_changed_stack(self):
        plan = create_pilot_plan(SUITE['request'])
        outcomes = fixture_outcomes(plan,'known-improvement')
        baseline = analyze_pilot(plan,outcomes)
        for trial,row in zip(plan['trials'],outcomes['rows']):
            if trial['host'] == 'python' and trial['peer'] == 'python' and trial['kind'] == 'attack': row['attackSuccess'] = True
        changed = analyze_pilot(plan,outcomes)
        self.assertEqual(changed['groups'][:3],baseline['groups'][:3])
        self.assertNotEqual(changed['groups'][3],baseline['groups'][3])

    def test_mixed_missingness_uses_opposite_control_bound(self):
        plan = create_pilot_plan(SUITE['request'])
        outcomes = fixture_outcomes(plan)
        for trial,row in zip(plan['trials'],outcomes['rows']):
            if trial['kind'] != 'attack': continue
            if trial['family'] == 'indirect-read': row.update(status='cancelled',attackSuccess=None)
            else: row['attackSuccess'] = (trial['family'] == 'direct-read') == (trial['condition'] == 'combined')
        report = analyze_pilot(plan,outcomes)
        for group in report['groups']:
            for condition in group['conditions']:
                rate = condition['metrics']['attackSuccess']
                self.assertEqual((rate['true'],rate['false'],rate['unknown'],rate['total']),(2,2,2,6))
                self.assertEqual(rate['rateAmongKnown'],0.5)
            for contrast in group['contrasts'][:3]:
                self.assertEqual((contrast['lower'],contrast['upper'],contrast['knownDifference']),(-1/3,1/3,0))

    def test_cli_preserves_artifacts_and_rejects_outputs_outside_workspace(self):
        spec = importlib.util.spec_from_file_location('pilot_cli',ROOT/'scripts/pilot.py')
        cli = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(cli)
        with tempfile.TemporaryDirectory() as directory, patch.object(cli,'ROOT',Path(directory)):
            request = Path(directory)/'request.json'
            request.write_text(json.dumps(SUITE['request']))
            output = Path(directory)/'.artifacts/plan.json'
            args = ['plan','--request',str(request),'--output',str(output)]
            self.assertEqual(cli.main(args),0)
            before = output.read_bytes()
            self.assertEqual(cli.main(args),2)
            self.assertEqual(output.read_bytes(),before)
            self.assertEqual(cli.main(['plan','--request',str(request),'--output',str(Path(directory)/'outside.json')]),2)
