# SPDX-License-Identifier: Apache-2.0
import json
import sys
import tempfile
import unittest
from copy import deepcopy
from pathlib import Path
from unittest.mock import patch, MagicMock

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT/'scripts'))
from campaign_engine import episode, parse_reply
from campaign_provider import decode, encode, ready, https_transport, TextProvider, CampaignError
from campaign_analysis import summarize
from campaign import live_check, reservation, plan_for, digest, load_records


class CampaignTests(unittest.TestCase):
    def setUp(self):
        self.config = json.loads((ROOT/'evaluation/campaign-config.example.json').read_text())
        self.config['limits']['maxTurns'] = 2
        self.corpus = json.loads((ROOT/'conformance/vectors/evaluation/campaign-corpus-0.1.json').read_text())

    def run_episode(self, case='state-attack', condition='psp+gates'):
        records = []; plan = {'id': 'episode-test', 'language': 'python', 'condition': condition, 'caseId': case, 'repeat': 0}
        bundle = {'config': self.config, 'corpus': self.corpus, 'nonce': 'f'*64, 'plan': [plan]}
        with tempfile.TemporaryDirectory() as d: episode(bundle, plan, Path(d), False, records.append)
        return bundle, records

    def test_persistent_state_and_host_gates(self):
        _, gated = self.run_episode(); _, plain = self.run_episode(condition='prompt')
        for rows in (gated, plain): self.assertEqual(rows[-1]['status'], 'complete')
        self.assertFalse(any(r['event']['forbidden'] for r in gated if r['kind'] == 'effect'))
        self.assertTrue(any(r['event']['forbidden'] for r in plain if r['kind'] == 'effect'))
        turn_two = next(r for r in gated if r['kind'] == 'call-start' and r['role'] == 'defender' and r['turn'] == 2)
        self.assertGreater(len(turn_two['messages']), 4)
        self.assertIn('GREEN', turn_two['messages'][-1]['content'])
        self.assertIn('"version":2', turn_two['messages'][-1]['content'])

    def test_attacker_and_judge_isolation(self):
        _, rows = self.run_episode('disclosure-attack')
        attacker = [r for r in rows if r['kind'] == 'call-start' and r['role'] == 'attacker']
        self.assertEqual(len(attacker), 2)
        self.assertNotIn('SYNTHETIC-PRIVATE-', json.dumps(attacker))
        for r in rows:
            if r['kind'] == 'call-start' and r['role'] == 'referee':
                self.assertEqual(len(r['messages']), 1)
                data = json.loads(r['messages'][0]['content'])
                self.assertEqual(len(data['evidence']), r['turn'])
                self.assertNotIn('condition', data); self.assertNotIn('judge', json.dumps(data))

    def test_invalid_judge_preserves_observed_effect(self):
        original = parse_reply
        def parse(kind, text):
            if kind == 'judge': raise CampaignError('INVALID_JUDGE')
            return original(kind, text)
        with patch('campaign_engine.parse_reply', side_effect=parse): bundle, rows = self.run_episode('disclosure-attack', 'prompt')
        self.assertEqual(rows[-1]['status'], 'incomplete')
        report = summarize(bundle, rows)
        self.assertEqual(report['episodes'][0]['objective'], 1)
        self.assertIsNone(next(r['judge'] for r in rows if r['kind'] == 'turn'))

    def test_unknown_planned_trials_stay_in_denominator(self):
        bundle, rows = self.run_episode('read-attack')
        bundle['plan'].append({**bundle['plan'][0], 'id': 'not-run', 'repeat': 1})
        curve = summarize(bundle, rows)['groups'][0]['curve'][-1]
        self.assertEqual((curve['planned'], curve['observed'], curve['unknown']), (2, 1, 1))
        self.assertEqual(curve['cumulativeRateUpper'], .5)

    def test_missing_later_turn_does_not_erase_success(self):
        bundle, rows = self.run_episode('disclosure-attack', 'prompt')
        report = summarize(bundle, [r for r in rows if r.get('turn', 1) == 1 and r['kind'] != 'done'])
        self.assertEqual(report['groups'][0]['curve'][-1]['cumulativeRateLower'], 1)

    def test_context_limit_does_not_truncate(self):
        p = self.config['roles']['attacker']; l = self.config['limits']
        with self.assertRaisesRegex(CampaignError, 'CONTEXT_LIMIT'):
            encode(p, l, 'system', [{'role': 'user', 'content': 'x'*(l['maxRequestBytes']+1)}])

    def test_no_implicit_network_or_unreviewed_provider(self):
        p = self.config['roles']['attacker']; l = self.config['limits']
        with self.assertRaisesRegex(CampaignError, 'OFFLINE_TRANSPORT_REQUIRED'): TextProvider(p, l, 1)
        with self.assertRaisesRegex(CampaignError, 'LIVE_NOT_ADMITTED'): TextProvider(p, l, 1, live=True)
        with self.assertRaisesRegex(CampaignError, 'PROVIDER_NOT_REVIEWED'): ready(p)
        p.update(complete=True, sources=[{'id': 'training-provider', 'capabilities': ['used-for-model-training']}])
        with self.assertRaisesRegex(CampaignError, 'PROVIDER_POLICY_DENIED'): ready(p)

    def test_provider_refuses_model_substitution_truncation_and_usage_overrun(self):
        p = self.config['roles']['attacker']; l = self.config['limits']
        value = {'model': p['model'], 'type': 'message', 'role': 'assistant', 'stop_reason': 'end_turn',
                 'content': [{'type': 'text', 'text': '{}'}], 'usage': {'input_tokens': 20, 'output_tokens': 10}}
        def reply(v): return {'status': 200, 'contentType': 'application/json', 'body': json.dumps(v).encode()}
        self.assertEqual(decode(p, l, reply(value))['usage']['inputTokens'], 20)
        for field, bad, code in [('model', 'unknown', 'MODEL_MISMATCH'), ('stop_reason', 'max_tokens', 'INCOMPLETE_RESPONSE'),
                                  ('usage', {'input_tokens': 20, 'output_tokens': 999999}, 'INVALID_USAGE')]:
            with self.assertRaisesRegex(CampaignError, code): decode(p, l, reply({**value, field: bad}))

    def test_shared_provider_vectors(self):
        vectors = json.loads((ROOT/'conformance/vectors/evaluation/campaign-provider-0.1.json').read_text())
        for case in vectors['cases']:
            with self.subTest(case=case['id']):
                p = {**self.config['roles']['attacker'], 'provider': case['provider'], 'model': case['model']}
                reply = {k: case[k] for k in ('status', 'contentType')}; reply['body'] = case['body'].encode()
                if case['code'] == 'OK': self.assertEqual(decode(p, self.config['limits'], reply)['usage']['inputTokens'], 30)
                else:
                    with self.assertRaisesRegex(CampaignError, case['code']): decode(p, self.config['limits'], reply)

    def test_live_budget_and_digest_admission(self):
        for role in self.config['roles'].values():
            role.update(complete=True, sources=[{'id': 'synthetic-reviewed-fixture', 'capabilities': []}], inputMicroUsdPerMillion=5000000, outputMicroUsdPerMillion=25000000)
        bundle = {'config': self.config, 'corpus': self.corpus, 'plan': plan_for(self.config, self.corpus)}
        bundle['reservation'] = reservation(bundle)
        with patch.dict('os.environ', {'ANTHROPIC_API_KEY': 'synthetic-test-key'}):
            with self.assertRaisesRegex(CampaignError, 'BUNDLE_NOT_ADMITTED'): live_check(bundle, 'wrong')
            with self.assertRaisesRegex(CampaignError, 'BUDGET_TOO_SMALL'): live_check(bundle, digest(bundle))
            self.config['limits']['budgetMicroUsd'] = bundle['reservation']['reservedMicroUsd']
            live_check(bundle, digest(bundle))

    def test_https_request_mapping_redirect_and_cancellation(self):
        connection = MagicMock(); response = connection.getresponse.return_value
        response.status = 200; response.getheader.side_effect = lambda name, default=None: {'Content-Type': 'application/json'}.get(name, default)
        response.read.side_effect = [b'{}', b'']
        with patch('campaign_provider.http.client.HTTPSConnection', return_value=connection) as factory:
            result = https_transport('anthropic', 'synthetic-secret', b'{}', self.config['limits'], lambda: False)
            self.assertEqual(result['body'], b'{}'); self.assertEqual(factory.call_args.args[0], 'api.anthropic.com')
            call = connection.request.call_args.args
            self.assertEqual(call[:3], ('POST', '/v1/messages', b'{}')); self.assertEqual(call[3]['anthropic-version'], '2023-06-01')
            self.assertEqual(call[3]['x-api-key'], 'synthetic-secret')
            response.status = 302
            with self.assertRaisesRegex(CampaignError, 'PROVIDER_HTTP_ERROR'): https_transport('anthropic', 'key', b'{}', self.config['limits'], lambda: False)
            connection.request.reset_mock()
            with self.assertRaisesRegex(CampaignError, 'CANCELLED'): https_transport('anthropic', 'key', b'{}', self.config['limits'], lambda: True)
            connection.request.assert_not_called()

    def test_recovery_accepts_only_torn_final_journal_line(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d)/'journal.jsonl'; p.write_text('{"kind":"done"}\n{"kind":', encoding='utf-8')
            self.assertEqual(load_records(p), [{'kind': 'done'}])
            p.write_text('{"kind":"done"}\n{"kind":\n', encoding='utf-8')
            with self.assertRaisesRegex(CampaignError, 'CORRUPT_JOURNAL'): load_records(p)

    def test_referee_schema_rejects_extra_fields_duplicate_keys_and_bad_indices(self):
        valid = {'semanticAttack': 'failure', 'benignTask': 'success', 'refusal': False, 'rationale': 'receipt', 'evidence': [0]}
        self.assertEqual(parse_reply('judge', json.dumps(valid)), valid)
        for bad in ({**valid, 'system': 'override'}, {**valid, 'evidence': [-1]}, {**valid, 'evidence': [0, 0]}):
            with self.assertRaisesRegex(CampaignError, 'INVALID_JUDGE'): parse_reply('judge', json.dumps(bad))
        with self.assertRaisesRegex(CampaignError, 'INVALID_ATTACK'): parse_reply('attack', '{"message":"a","message":"b"}')


if __name__ == '__main__': unittest.main()
