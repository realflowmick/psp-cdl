# SPDX-License-Identifier: Apache-2.0
import copy
import json
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0,str(ROOT / "scripts"))
from topology_matrix import assemble, exit_code, grade, index_observations

SUITE = json.loads((ROOT / "conformance/vectors/topologies/matrix-0.1.json").read_text(encoding="utf-8"))
CASES = [c for c in SUITE["cases"] if c["kind"] != "blocked"]
PAIRS = [(h,p) for h in ("typescript","python") for p in ("typescript","python")]


class TopologyMatrixTests(unittest.TestCase):
    def observations(self):
        entries = [{"id":c["id"],"observation":copy.deepcopy(c["expected"])} for c in CASES]
        return {pair:index_observations(copy.deepcopy(entries),SUITE["cases"]) for pair in PAIRS}

    def test_complete_fixture_scope_is_not_full_conformance(self):
        report = assemble(SUITE,{"commit":"0"*40},self.observations())
        self.assertEqual(report["summary"],{"passed":48,"failed":0,"blocked":12,"unsupported":96,"skipped":0,"error":0})
        self.assertTrue(report["scopePassed"])
        self.assertFalse(report["fullConformance"])
        self.assertEqual(exit_code(report),2)
        self.assertEqual(exit_code(report,check=True),0)
        bypass = [c for c in report["cells"] if c["variant"] == "bypass-control"]
        self.assertTrue(all(c["enforcementPoints"] == [] for c in bypass))

    def test_effect_output_and_authority_mutations_fail(self):
        case = next(c for c in CASES if c["id"] == "seed-affinity-denied")
        for field,value in [("events",case["expected"]["events"]+[{"kind":"read","recordId":"public"}]),
                            ("outputs",["leaked"]),("providerToolMessages",["leaked"]),("authorityLeak",True),
                            ("codes",["OK"]),("providerCalls",True)]:
            with self.subTest(field=field):
                observed = copy.deepcopy(case["expected"])
                observed[field] = value
                self.assertEqual(grade(case,{"observation":observed})[0],"failed")

    def test_missing_duplicate_extra_and_malformed_results_reject_whole_adapter(self):
        entries = [{"id":c["id"],"observation":c["expected"]} for c in CASES]
        for invalid in [entries[:-1],entries+[entries[0]],entries[:-1]+[entries[0]],None,{},
                        [{**entries[0],"unexpected":True}]+entries[1:]]:
            self.assertIsNone(index_observations(invalid,SUITE["cases"]))
        self.assertEqual(grade(CASES[0],{"error":"ADAPTER_ERROR"})[0],"error")

    def test_adapter_error_is_not_a_denial_pass(self):
        observed = self.observations()
        observed[PAIRS[0]] = None
        report = assemble(SUITE,{"commit":"0"*40},observed)
        self.assertEqual(report["summary"]["error"],12)
        self.assertFalse(report["scopePassed"])
        self.assertEqual(exit_code(report,check=True),1)

    def test_failed_observation_fails_check(self):
        observed = self.observations()
        observed[PAIRS[0]][CASES[0]["id"]]["observation"]["outputs"] = ["forbidden"]
        report = assemble(SUITE,{"commit":"0"*40},observed)
        self.assertEqual(report["summary"]["failed"],1)
        self.assertEqual(exit_code(report,check=True),1)

    def test_skip_and_unsupported_remain_distinct_and_cannot_satisfy_check(self):
        report = assemble(SUITE,{"commit":"0"*40},self.observations(),selected={PAIRS[0]})
        self.assertEqual(report["summary"]["skipped"],36)
        self.assertEqual(exit_code(report,check=True),2)
        report = assemble(SUITE,{"commit":"0"*40},self.observations(),unavailable={PAIRS[0]:"Runtime missing."})
        self.assertEqual(report["summary"]["unsupported"],108)
        self.assertEqual(report["summary"]["skipped"],0)
        self.assertFalse(report["scopePassed"])
        self.assertEqual(exit_code(report,check=True),2)

    def test_manifest_assembly_is_deterministic(self):
        self.assertEqual(json.dumps(assemble(SUITE,{"commit":"0"*40},self.observations())),
                         json.dumps(assemble(SUITE,{"commit":"0"*40},self.observations())))

    def test_empty_executable_scope_cannot_pass(self):
        blocked = {**SUITE,"cases":[c for c in SUITE["cases"] if c["kind"] == "blocked"]}
        report = assemble(blocked,{"commit":"0"*40},{})
        self.assertFalse(report["scopePassed"])
        self.assertEqual(exit_code(report,check=True),2)
        report = assemble(SUITE,{"commit":"0"*40},self.observations(),selected=set())
        self.assertEqual(report["summary"]["skipped"],48)
        self.assertFalse(report["scopePassed"])
