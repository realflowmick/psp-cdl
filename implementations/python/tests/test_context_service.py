# SPDX-License-Identifier: Apache-2.0
from pathlib import Path
import sys
import unittest
sys.path.insert(0,str(Path(__file__).resolve().parents[3]/'scripts'))
from context_service_fixtures import SUITE, run_case
class ContextServiceTests(unittest.TestCase):
    def test_shared_cases(self):
        for case in SUITE['cases']:
            with self.subTest(case=case['id']):
                actual=run_case(case)
                for key,value in case['expected'].items():self.assertEqual(actual[key],value,actual)
