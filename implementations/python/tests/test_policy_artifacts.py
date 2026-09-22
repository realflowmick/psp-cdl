# SPDX-License-Identifier: Apache-2.0
"""Read shared policy artifacts independently; not a production policy evaluator."""
import hashlib
import json
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError(f"Duplicate artifact key: {key}")
        result[key] = value
    return result


def load(path):
    return json.loads((ROOT / path).read_text(encoding="utf-8"), object_pairs_hook=unique_object)


class PolicyArtifactTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.table = load("conformance/policy/cdl-1.0.json")
        cls.vectors = load("conformance/vectors/policy/profile-1.0.json")
        cls.enforcement = load("conformance/policy/enforcement-1.0.json")

    def test_vectors_pin_exact_table_and_advertise_no_execution(self):
        actual = hashlib.sha256((ROOT / "conformance/policy/cdl-1.0.json").read_bytes()).hexdigest()
        self.assertEqual(self.vectors["tableSha256"], actual)
        self.assertEqual(self.vectors["executionStatus"], "unimplemented")
        self.assertEqual(self.vectors["profile"], self.table["profile"])
        self.assertEqual(self.vectors["companionProfile"], self.enforcement["profile"])

    def test_every_appendix_matrix_row_is_accounted_for(self):
        source = (ROOT / "specs/cdl/RFC-CDL-v1_5.md").read_text(encoding="utf-8")
        expected = []
        for section, end in (("B.2", "B.3"), ("B.3", "B.4")):
            text = source.split("### " + section + " ", 1)[1].split("### " + end + " ", 1)[0]
            expected.extend((section, term) for term in re.findall(r"^\| `([^`]+)`", text, re.M))
        actual = [(row["section"], row["row"]) for row in self.table["appendixCoverage"]]
        self.assertEqual(sorted(actual), sorted(expected))

    def test_rule_references_and_result_order(self):
        rules = {rule["id"] for rule in self.table["rules"]}
        self.assertEqual(len(rules), len(self.table["rules"]))
        cases = self.vectors["cases"]
        self.assertEqual(len({case["id"] for case in cases}), len(cases))
        covered = set()
        stages = self.table["reasonStages"] + [self.enforcement["trustReasonCodes"]]
        for case in cases:
            with self.subTest(case=case["id"]):
                covered.update(case["ruleIds"])
                reasons = case["expected"]["reasonCodes"]
                if case["expected"]["decision"] == "allow":
                    self.assertEqual(reasons, [])
                else:
                    self.assertTrue(reasons)
                    self.assertTrue(any(reasons == [r for r in stage if r in reasons] for stage in stages))
        self.assertEqual(covered, rules)

    def test_six_levels_and_topology_superset(self):
        self.assertEqual([row["level"] for row in self.enforcement["levels"]], list(range(6)))
        self.assertEqual(self.enforcement["unsignedDefaults"], {"user": 4, "external": 5})
        self.assertLess(set(self.enforcement["requiredGates"]["B"]), set(self.enforcement["requiredGates"]["C"]))


if __name__ == "__main__":
    unittest.main()
