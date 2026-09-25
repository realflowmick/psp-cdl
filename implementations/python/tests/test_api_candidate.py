# SPDX-License-Identifier: Apache-2.0
"""Review guards are bookkeeping checks, not authorization to adopt a standard."""
import importlib.util
import hashlib
import json
import unittest
from copy import deepcopy
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
SPEC = importlib.util.spec_from_file_location("api_candidate", ROOT/"scripts/generate-api-candidate.py")
CANDIDATE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(CANDIDATE)


class ApiCandidateTests(unittest.TestCase):
    def test_frozen_contracts_match_all_http_and_mcp_operations(self):
        generated = CANDIDATE.generate()
        for path, data in generated.items():
            self.assertEqual(json.loads((ROOT/path).read_text(encoding="utf-8")), data, path)
        index = generated["specs/api/contract-set-1.0.0.json"]
        self.assertEqual(sum(op["required"] for op in index["operations"]), 11)
        optional = {op["name"] for op in index["operations"] if not op["required"]}
        self.assertEqual(optional, {"realflow.policy.evaluate", "realflow.sessions.cancel", "realflow.sessions.purge"})
        self.assertEqual(len(index["editorialCorrections"]), 11)
        self.assertTrue(all(c["sourceAnchor"] != c["proposedAnchor"] and c["targetEdition"] is None for c in index["editorialCorrections"]))
        for source in index["baselineSources"]:
            self.assertEqual(source["digestForm"], "sha256-raw-bytes")
            self.assertEqual(source["sha256"], hashlib.sha256((ROOT/source["path"]).read_bytes()).hexdigest())

    def test_current_record_does_not_claim_adoption(self):
        record = CANDIDATE.read("specs/api/adoption-1.0.0.json")
        CANDIDATE.check_adoption(record)
        self.assertFalse(record["accepted"])
        self.assertIsNone(record["maintainerDecision"])

    def test_early_acceptance_and_unresolved_comments_are_rejected(self):
        record = deepcopy(CANDIDATE.read("specs/api/adoption-1.0.0.json"))
        record.update(status="proposed-standard", accepted=True)
        record["review"] = {"url": "https://github.com/realflowmick/psp-cdl/pull/99999",
                            "openedAt": "2030-01-01T12:00:00Z", "lastSubstantiveChangeAt": "2030-01-01T12:00:00Z",
                            "closesNoEarlierThan": "2030-01-15T12:00:00Z", "minimumCommentDays": 14}
        record["maintainerDecision"] = {"by": "realflowmick", "at": "2030-01-15T12:00:00Z",
                                        "rationale": "Synthetic test decision, not actual approval.",
                                        "recordUrl": record["review"]["url"]+"#issuecomment-test", "independentReview": False}
        for item in record["dispositions"]:
            if item["id"] != "PSP-E007-E009": item["status"] = "accepted"
        before = datetime(2030, 1, 15, 11, 59, 59, tzinfo=timezone.utc)
        after = datetime(2030, 1, 15, 12, tzinfo=timezone.utc)
        with self.assertRaises(AssertionError): CANDIDATE.check_adoption(record, before)
        CANDIDATE.check_adoption(record, after)
        record["comments"] = [{"url": "synthetic-comment", "disposition": "pending", "rationale": None}]
        with self.assertRaises(AssertionError): CANDIDATE.check_adoption(record, after)
        record["comments"] = []
        record["maintainerDecision"] = None
        with self.assertRaises(AssertionError): CANDIDATE.check_adoption(record, after)

    def test_substantive_revision_needs_a_new_full_window(self):
        record = deepcopy(CANDIDATE.read("specs/api/adoption-1.0.0.json"))
        record.update(status="public-review", accepted=False, maintainerDecision=None)
        record["review"] = {"url": "https://github.com/realflowmick/psp-cdl/pull/99999",
                            "openedAt": "2030-01-01T12:00:00Z", "lastSubstantiveChangeAt": "2030-01-02T12:00:00Z",
                            "closesNoEarlierThan": "2030-01-15T12:00:00Z", "minimumCommentDays": 14}
        now = datetime(2030, 1, 3, tzinfo=timezone.utc)
        with self.assertRaises(AssertionError): CANDIDATE.check_adoption(record, now)
        record["review"]["closesNoEarlierThan"] = "2030-01-16T12:00:00Z"
        CANDIDATE.check_adoption(record, now)
        record["review"]["minimumCommentDays"] = 0
        with self.assertRaises(AssertionError): CANDIDATE.check_adoption(record, now)
