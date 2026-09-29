# SPDX-License-Identifier: Apache-2.0
import json
from pathlib import Path
import sys
import unittest
import psp_cdl_core as core
sys.path.insert(0,str(Path(__file__).resolve().parents[3]/'scripts'))
from llm_fixtures import run_case
SUITE=json.loads((Path(__file__).resolve().parents[3]/'conformance/vectors/llm/in-context-0.1.json').read_text(encoding='utf-8'))
class ContextTests(unittest.TestCase):
    def test_context_transport_and_boundary_controls(self):
        for c in SUITE['cases']:
            with self.subTest(case=c['id']):
                actual=run_case(c)
                for k,v in c['expected'].items():self.assertEqual(actual[k],v,actual)
                for request in actual['requests']:
                    self.assertEqual(request['messages'][0]['content'],c['settings']['promptText'])
                    for secret in ('test-owner','test-signing-key','tenant-a','sessionVersion'):self.assertNotIn(secret,json.dumps(request))
                if 'expectedText' in c:self.assertEqual(actual['result']['text'],c['expectedText'])
    def test_codec_preserves_conditions_and_structure(self):
        tree=core.parse_markup(SUITE['application']);roundtrip=core.parse_markup(core.serialize_markup(tree))
        tree.pop('source');roundtrip.pop('source');self.assertEqual(roundtrip,tree)
        self.assertFalse(hasattr(core,'select_transition'));self.assertFalse(hasattr(core,'compile_application'))
