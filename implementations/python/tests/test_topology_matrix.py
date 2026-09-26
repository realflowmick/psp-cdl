# SPDX-License-Identifier: Apache-2.0
import copy
import json
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0,str(ROOT/'scripts'))
from topology_matrix import assemble, combinations, exit_code, grade, index_observations, validate_inputs, validate_report
from topology_adapter import run_direct, DirectError

def read(path): return json.loads((ROOT/path).read_text(encoding='utf-8'))
SUITE = read('conformance/vectors/topologies/matrix-0.2.json')
INVENTORY = read('conformance/requirements.json')
MAPPINGS = read('conformance/workflow-mappings-0.2.json')
COMBINATIONS = combinations()


class TopologyMatrixTests(unittest.TestCase):
    def test_direct_callback_rejects_malformed_responses_and_bounds_loops(self):
        calls = []
        registrations = [{'server':'reference','name':'allowed','inputSchema':{},'outputSchema':{},'invoke':lambda *_:calls.append(True) or {'message':'public'}}]
        options = {'cancelled':lambda:False,'maxSteps':2}
        for response in [None,{},[],{'type':'final','text':1},{'type':'tool','name':'reference.allowed'},
                         {'type':'tool','name':'reference.allowed','arguments':[]}]:
            with self.subTest(response=response), self.assertRaises(DirectError) as caught:
                run_direct({'invoke':lambda *_:response},registrations,'synthetic',options)
            self.assertEqual(caught.exception.code,'INVALID_RESPONSE')
        self.assertEqual(calls,[])
        with self.assertRaises(DirectError) as caught:
            run_direct({'invoke':lambda *_:{'type':'tool','name':'reference.allowed','arguments':{}}},registrations,'synthetic',options)
        self.assertEqual(caught.exception.code,'STEP_LIMIT')
        self.assertEqual(len(calls),2)

    def observations(self):
        return {combination:index_observations([{'id':c['id'],'observation':copy.deepcopy(c['expected'][combination[0]])}
            for c in SUITE['cases'] if c['expected'][combination[0]] is not None],SUITE['cases'],combination[0]) for combination in COMBINATIONS}

    def report(self, observations=None, **kwargs):
        return assemble(SUITE,INVENTORY,MAPPINGS,{'commit':'0'*40},self.observations() if observations is None else observations,**kwargs)

    def test_all_applicable_combinations_and_every_inventory_entry(self):
        report = self.report()
        validate_report(SUITE,INVENTORY,MAPPINGS,report)
        self.assertEqual(report['summary'],{'passed':324,'failed':0,'blocked':0,'unsupported':12,'skipped':0,'error':0})
        self.assertTrue(report['scopePassed'])
        self.assertEqual(exit_code(report),2)
        self.assertEqual(exit_code(report,True),0)
        coverage = report['requirements']
        self.assertEqual(coverage['totalRequirements'],460)
        self.assertEqual(coverage['mappedRequirements'],27)
        self.assertEqual(coverage['requirementsWithPassingEvidence'],27)
        self.assertEqual({r['requirementId'] for r in coverage['entries']},{r['id'] for r in INVENTORY['requirements']})
        self.assertEqual(coverage['summary']['passed'],0)
        self.assertEqual(sum(coverage['summary'].values()),920)
        self.assertTrue(all(c['enforcementPoints'] == [] for c in report['cells'] if c['topology'] == 'A'))

    def test_effects_output_authority_types_and_missing_gate_decisions_fail(self):
        expected = next(c for c in SUITE['cases'] if c['id'] == 'server-output-denial')['expected']['C']
        for field,value in [('events',expected['events'][:-1]),('proxyEvents',[]),('outputs',['leaked']),('providerToolMessages',['leaked']),
                            ('authorityLeak',True),('codes',['OK']),('providerCalls',True)]:
            with self.subTest(field=field):
                observed = copy.deepcopy(expected)
                observed[field] = value
                self.assertEqual(grade(expected,{'observation':observed})[0],'failed')

    def test_missing_duplicate_extra_and_malformed_adapter_results(self):
        entries = [{'id':c['id'],'observation':c['expected']['C']} for c in SUITE['cases']]
        for invalid in [entries[:-1],entries+[entries[0]],entries[:-1]+[entries[0]],None,{},
                        [{**entries[0],'unexpected':True}]+entries[1:]]:
            self.assertIsNone(index_observations(invalid,SUITE['cases'],'C'))

    def test_adapter_error_and_failed_observation_never_pass(self):
        observed = self.observations()
        observed[COMBINATIONS[-1]] = None
        report = self.report(observed)
        self.assertEqual(report['summary']['error'],21)
        self.assertEqual(exit_code(report,True),1)
        observed = self.observations()
        observed[COMBINATIONS[-1]]['server-output-denial']['observation']['outputs'] = ['forbidden']
        report = self.report(observed)
        self.assertEqual(report['summary']['failed'],1)
        self.assertEqual(exit_code(report,True),1)

    def test_skipped_and_unsupported_are_distinct(self):
        report = self.report(selected={COMBINATIONS[0]})
        self.assertEqual(report['summary']['skipped'],306)
        self.assertEqual(exit_code(report,True),2)
        report = self.report(unavailable={COMBINATIONS[0]:'Runtime unavailable.'})
        self.assertEqual(report['summary']['unsupported'],30)
        self.assertFalse(report['scopePassed'])

    def test_missing_seed_required_control_and_dangling_mapping_reject(self):
        for case_id in ('seed-lexical-declaration','server-output-denial','replay-old-prompt'):
            suite = copy.deepcopy(SUITE)
            suite['cases'] = [c for c in suite['cases'] if c['id'] != case_id]
            with self.assertRaises(ValueError): validate_inputs(suite,INVENTORY,MAPPINGS)
        for field,value in [('requirements',['UNKNOWN']),('cases',[{'id':'not-a-case','topologies':['C']}])]:
            mappings = copy.deepcopy(MAPPINGS)
            mappings['mappings'][0][field] = value
            with self.assertRaises(ValueError): validate_inputs(SUITE,INVENTORY,mappings)

    def test_manifest_cannot_drop_or_promote_pending_requirements(self):
        report = self.report()
        report['requirements']['entries'].pop()
        with self.assertRaises(ValueError): validate_report(SUITE,INVENTORY,MAPPINGS,report)
        report = self.report()
        report['requirements']['entries'][0]['results'][0]['status'] = 'passed'
        with self.assertRaises(ValueError): validate_report(SUITE,INVENTORY,MAPPINGS,report)

    def test_manifest_cannot_drop_cases_forge_grades_or_claim_conformance(self):
        report = self.report()
        report['cells'].pop()
        with self.assertRaises(ValueError): validate_report(SUITE,INVENTORY,MAPPINGS,report)
        report = self.report()
        report['cells'][0]['observation']['outputs'] = ['changed']
        with self.assertRaises(ValueError): validate_report(SUITE,INVENTORY,MAPPINGS,report)
        report = self.report()
        report['fullConformance'] = True
        with self.assertRaises(ValueError): validate_report(SUITE,INVENTORY,MAPPINGS,report)
        report = self.report()
        report['cells'][0]['peerImplementation'] = 'python'
        with self.assertRaises(ValueError): validate_report(SUITE,INVENTORY,MAPPINGS,report)

    def test_empty_selection_and_reproducibility(self):
        self.assertFalse(self.report(selected=set())['scopePassed'])
        self.assertEqual(json.dumps(self.report()),json.dumps(self.report()))
