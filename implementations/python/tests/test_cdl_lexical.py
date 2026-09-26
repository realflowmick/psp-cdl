# SPDX-License-Identifier: Apache-2.0
import json
import unittest
from pathlib import Path
from psp_cdl_cdl import tokenize_declaration, normalize_declaration
from psp_cdl_core import PspError

ROOT = Path(__file__).resolve().parents[3]
SUITE = json.loads((ROOT/'conformance/vectors/codec/cdl-lexical-0.1.json').read_text(encoding='utf-8'))


class LexicalTests(unittest.TestCase):
    def test_shared_lexical_vectors(self):
        for c in SUITE['cases']:
            with self.subTest(case=c['id']):
                value = c['repeatText']*c['count'] if 'repeatText' in c else [c['repeatArray']]*c['count'] if 'repeatArray' in c else c['input']
                if 'error' in c:
                    with self.assertRaises(PspError) as caught: tokenize_declaration(value)
                    self.assertEqual(caught.exception.code,c['error'])
                else: self.assertEqual(tokenize_declaration(value),c['terms'])

    def test_tokens_are_not_typed_policy_authority(self):
        for kind in ('classes','covenants'):
            with self.assertRaises(PspError) as caught: normalize_declaration(kind,'PII no-training')
            self.assertEqual(caught.exception.code,'UNSUPPORTED_TERM')
        with self.assertRaises(PspError) as caught: normalize_declaration('classes',['!no-training','x'*129])
        self.assertEqual(caught.exception.code,'INVALID_DECLARATION')
        with self.assertRaises(PspError) as caught: normalize_declaration('covenants',['no-training','!no-training'])
        self.assertEqual(caught.exception.code,'CONTRADICTORY_DECLARATION')
        self.assertEqual(normalize_declaration('classes',['restricted','pii']),['pii','restricted'])
