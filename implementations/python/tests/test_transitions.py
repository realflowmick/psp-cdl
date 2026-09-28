# SPDX-License-Identifier: Apache-2.0
from copy import deepcopy
import json
from pathlib import Path
import unittest
from psp_cdl_core import PspError, select_transition

ROOT = Path(__file__).resolve().parents[3]
CASES = json.loads((ROOT / "conformance/vectors/transitions/profile-0.1.json").read_text(encoding="utf-8"))["cases"]


class TransitionsTest(unittest.TestCase):
    def test_shared_vectors(self):
        for case in CASES:
            with self.subTest(case=case["id"]):
                if "error" in case["expected"]:
                    with self.assertRaises(PspError) as caught:
                        select_transition(case["request"])
                    self.assertEqual(caught.exception.code, case["expected"]["error"])
                else:
                    self.assertEqual(select_transition(case["request"]), case["expected"]["result"])

    def test_no_mutation_or_authority_alias(self):
        request = deepcopy(CASES[0]["request"])
        before = deepcopy(request)
        result = select_transition(request)
        result["usedFacts"].append("changed")
        self.assertEqual(request, before)
        self.assertEqual(select_transition(request), CASES[0]["expected"]["result"])

    def test_objects_cannot_supply_executable_values(self):
        class Value:
            def __eq__(self, other):
                raise AssertionError("Must never evaluate a non-JSON object")
        request = deepcopy(CASES[0]["request"])
        request["facts"]["amount"]["value"] = Value()
        with self.assertRaises(PspError) as caught:
            select_transition(request)
        self.assertEqual(caught.exception.code, "INVALID_JSON_VALUE")
