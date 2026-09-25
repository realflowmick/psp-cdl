# SPDX-License-Identifier: Apache-2.0
import importlib.util
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[3]
spec = importlib.util.spec_from_file_location("fuzz", ROOT / "scripts/differential-fuzz.py")
fuzz = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fuzz)


class FuzzHarnessTests(unittest.TestCase):
    def test_seed_reproduces_and_exercises_all_signature_dispositions(self):
        cases = list(fuzz.generated(36, 200))
        self.assertEqual(cases, list(fuzz.generated(36, 200)))
        self.assertNotEqual(cases, list(fuzz.generated(37, 200)))
        decisions = {fuzz.execute(c)["decision"] for c in cases if c["op"] == "signature"}
        self.assertEqual(decisions, {"valid", "EXPIRED", "REVOKED_KEY", "INVALID_SIGNATURE", "INVALID_ENCODING"})

    def test_reducer_preserves_mismatch_and_has_finite_call_budget(self):
        with patch.object(fuzz, "execute", return_value={"status": "ok"}), patch.object(
            fuzz, "peer", side_effect=lambda cases: [{"status": "different" if "X" in cases[0]["source"] else "ok"}]
        ) as peer:
            result = fuzz.minimize({"op": "json", "source": "long-synthetic-X-case"}, budget=40)
            self.assertEqual(result["source"], "X")
            self.assertLessEqual(peer.call_count, 40)
