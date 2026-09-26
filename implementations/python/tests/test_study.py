# SPDX-License-Identifier: Apache-2.0
import copy
import importlib.util
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch, Mock

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0,str(ROOT/'scripts'))
from study import aggregate, budget, encoded, exit_code, grade, money, trials, validate_corpus, validate_results
from study_adapter import direct_loop, StudyError, offline_reply
from study_common import CORPUS, case_input
from psp_cdl_llmproxy import OPENAI_CHAT_MODEL, OPENAI_CHAT_REVISION, OPENAI_CHAT_INPUT_RESERVATION

spec = importlib.util.spec_from_file_location('study_runner',ROOT/'scripts/run-study.py')
runner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)


class StudyTests(unittest.TestCase):
    def test_plan_provider_and_budget_pins_match_the_adapter(self):
        self.assertEqual(OPENAI_CHAT_MODEL,'gpt-4.1-mini-2025-04-14')
        self.assertEqual(OPENAI_CHAT_REVISION,'chat-v1-gpt-4.1-mini-2025-04-14-psp-0.1')
        self.assertEqual(OPENAI_CHAT_INPUT_RESERVATION,1047576)

    def observation(self, case_id, condition='unprotected'):
        case = next(c for c in CORPUS['cases'] if c['id'] == case_id)
        expected = case['offlineExpected'][condition]
        observation = {k:expected[k] for k in ('code','output','providerCalls')}
        observation.update(events=[{'kind':'isolation-probes-blocked','recordId':None,'code':None}]+
            [{'kind':'read','recordId':r,'code':None} for r in expected['reads']],providerError=None,requestDigest='0'*64,authorityLeak=False,elapsedMs=5)
        return case, observation

    def test_observed_bypass_is_attack_success_but_passing_pipeline_control(self):
        case, observation = self.observation('attack-direct-private')
        result = grade(case,'unprotected',observation,'offline')
        self.assertTrue(result['outcome']['attackSuccess'])
        self.assertTrue(result['offlineExpectationMatched'])
        self.assertNotIn(case['input']['privateText'],json.dumps(result))
        self.assertNotIn('output',result['observation'])

    def test_operational_errors_remain_unknown_and_cannot_hide_observed_effects(self):
        case, observation = self.observation('attack-direct-private','combined')
        observation.update(code='PROVIDER_FAILED',providerError='DEADLINE_EXCEEDED',output=None)
        result = grade(case,'combined',observation,'live')
        self.assertEqual(result['status'],'error')
        self.assertIsNone(result['outcome']['attackSuccess'])
        observation['events'].append({'kind':'read','recordId':'private','code':None})
        self.assertTrue(grade(case,'combined',observation,'live')['outcome']['attackSuccess'])

    def test_exhausted_loop_is_not_a_defended_attack(self):
        case, observation = self.observation('attack-direct-private','combined')
        observation.update(code='STEP_LIMIT',output=None)
        result = grade(case,'combined',observation,'live')
        self.assertEqual(result['status'],'error')
        self.assertIsNone(result['outcome']['attackSuccess'])

    def test_fixture_startup_failure_retains_the_error_code_and_unknown_outcome(self):
        case, observation = self.observation('attack-direct-private','combined')
        observation.update(code='PEER_TIMEOUT',output=None,events=[],providerCalls=0)
        result = grade(case,'combined',observation,'offline')
        self.assertEqual(result['status'],'error')
        self.assertEqual(result['observation']['code'],'PEER_TIMEOUT')
        self.assertIsNone(result['outcome']['attackSuccess'])

    def test_release_canary_and_tool_effect_are_independent(self):
        case, observation = self.observation('attack-display-private','combined')
        self.assertFalse(grade(case,'combined',observation,'offline')['outcome']['attackSuccess'])
        observation.update(code='OK',output=case['input']['privateText'])
        result = grade(case,'combined',observation,'offline')
        self.assertFalse(result['offlineExpectationMatched'])
        self.assertTrue(result['outcome']['disclosure'])
        self.assertFalse(result['outcome']['unauthorizedRead'])

    def test_benign_failure_and_false_denial_are_distinct(self):
        case, observation = self.observation('benign-public')
        observation['output'] = 'wrong'
        result = grade(case,'unprotected',observation,'live')
        self.assertFalse(result['outcome']['benignSuccess'])
        self.assertFalse(result['outcome']['falseDenial'])
        observation.update(code='OUTPUT_DENIED',output=None)
        result = grade(case,'unprotected',observation,'live')
        self.assertFalse(result['outcome']['benignSuccess'])
        self.assertTrue(result['outcome']['falseDenial'])

    def test_invalid_evidence_and_authority_leak_do_not_pass(self):
        case, observation = self.observation('benign-public')
        for change in ({'events':[]},{'output':None},{'code':'OUTPUT_DENIED'}):
            with self.subTest(change=change), self.assertRaises(ValueError): grade(case,'unprotected',{**observation,**change},'offline')
        result = grade(case,'unprotected',{**observation,'authorityLeak':True},'offline')
        self.assertEqual(result['status'],'error')
        self.assertFalse(result['offlineExpectationMatched'])

    def test_budget_exact_arithmetic_and_full_plan_reservation(self):
        b = budget(2,'100','1','4')
        self.assertEqual(b['perCallMicroUsd'],1048088)
        self.assertEqual(b['planReservedMicroUsd'],8*1048088)
        for value in ('NaN','Infinity','0','-1','0.0000001',True):
            with self.subTest(value=value), self.assertRaises(ValueError): money(value)
        with self.assertRaises(ValueError): budget(2,'1','1','4')

    def test_live_preflight_rejects_without_reading_credentials_or_starting_trials(self):
        original = runner.os.environ.get
        def environment_get(key, *args):
            if key == 'PSP_OPENAI_API_KEY': raise AssertionError('Credential lookup')
            return original(key,*args)
        with patch.object(runner,'validate'), patch.object(runner.shutil,'which',return_value='node'), \
             patch.object(runner.subprocess,'check_output',return_value='v24.0.0'), \
             patch.object(runner.os.environ,'get',side_effect=environment_get), \
             patch.object(runner,'execute',side_effect=AssertionError('Execution')):
            for args in (['--mode','live'],['--mode','live','--allow-live'],['--allow-live']):
                with self.subTest(args=args), self.assertRaises(ValueError): runner.main(args)

    def test_no_missing_duplicate_or_silent_subset_results(self):
        selected = trials(CORPUS,['typescript','python'],['typescript','python'],list(CORPUS['conditions']),[c['id'] for c in CORPUS['cases']],1)
        self.assertEqual(len(selected),96)
        validate_results({'trials':selected},selected)
        for rows in (selected[:-1],selected+[selected[0]],selected[:-1]+[selected[0]]):
            with self.assertRaises(ValueError): validate_results({'trials':selected},rows)
        with self.assertRaises(ValueError): trials(CORPUS,['python','python'],['python'],['combined'],['benign-public'],1)
        with self.assertRaises(ValueError): trials(CORPUS,['python'],['python'],['combined'],['unknown'],1)
        validate_corpus(CORPUS)

    def test_unknowns_are_visible_in_aggregate_denominators(self):
        row = {'condition':'combined','host':'python','peer':'python','kind':'attack','status':'error'}
        group = aggregate([row])[0]
        self.assertEqual(group['attackSuccess'],{'true':0,'false':0,'unknown':1,'total':1,'rateAmongKnown':None})
        self.assertEqual(exit_code({'results':[row]}),1)
        row['status'] = 'skipped'
        self.assertEqual(exit_code({'results':[row]}),2)

    def test_cancelled_trial_is_incomplete_not_a_safe_attack(self):
        case, observation = self.observation('attack-direct-private','combined')
        observation.update(code='CANCELLED',output=None,providerError='CANCELLED')
        result = grade(case,'combined',observation,'offline')
        self.assertEqual(result['status'],'cancelled')
        self.assertIsNone(result['outcome']['attackSuccess'])
        self.assertIsNone(result['offlineExpectationMatched'])
        self.assertEqual(exit_code({'results':[result]}),2)

    def test_runner_suppresses_late_output_on_cancel_or_watchdog(self):
        _, observation = self.observation('benign-public')
        trial = {'caseId':'benign-public','condition':'unprotected','host':'python','peer':'python'}
        for cancelled in (False,True):
            process = Mock(returncode=0)
            process.communicate.return_value = (json.dumps(observation),None)
            process.poll.return_value = 0
            with tempfile.TemporaryDirectory() as directory, patch.object(runner.subprocess,'Popen',return_value=process), \
                 patch.object(runner,'validate'), patch.object(runner.time,'monotonic',side_effect=[0,76,76,76]):
                path = Path(directory)/'cancel'
                result = runner.execute(trial,{'mode':'offline'},'node',path,lambda:cancelled,'')
                self.assertTrue(path.exists())
                self.assertIsNone(result['output'])
                self.assertEqual(result['code'],'CANCELLED' if cancelled else 'DEADLINE_EXCEEDED')
                self.assertEqual(result['events'],observation['events'])

    def test_direct_loop_cancellation_and_tool_bound(self):
        calls = []
        registration = {'name':'public','sources':[],'inputSchema':{},'outputSchema':{},'invoke':lambda *_:calls.append(1) or {'message':'public'}}
        provider = {'sources':[],'invoke':lambda *_:{'type':'tool','name':'study.public','arguments':{}}}
        options = {'deadline':10,'cancelled':lambda:True,'maxSteps':2}
        with self.assertRaises(StudyError) as caught: direct_loop(provider,[registration],case_input('benign-public'),options,False,lambda:0)
        self.assertEqual(caught.exception.code,'CANCELLED')
        self.assertEqual(calls,[])
        options['cancelled'] = lambda:False
        with self.assertRaises(StudyError) as caught: direct_loop(provider,[registration],case_input('benign-public'),options,False,lambda:0)
        self.assertEqual(caught.exception.code,'STEP_LIMIT')
        self.assertEqual(calls,[1])

    def test_offline_transport_respects_filtered_catalogue(self):
        result = offline_reply(case_input('attack-direct-private'),0,{'tools':[]})
        self.assertEqual(result['choices'][0]['message']['content'],'UNAVAILABLE')
