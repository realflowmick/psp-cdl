# SPDX-License-Identifier: Apache-2.0
import importlib.util
import json
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]


def load(name):
    spec = importlib.util.spec_from_file_location(name, ROOT / "scripts" / (name + ".py"))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class InventoryTests(unittest.TestCase):
    def test_keyword_boundaries_fences_and_lead_in_context(self):
        source = '# Example\nImplementations MUST NOT:\n\n- leak data\n- lose state\n\n## Next\n```text\nMUST illustrative\n```\nClients SHALL check and SHOULD NOT retry.\n'
        rows = load("generate-requirements").audit(source, "psp", "test", "source")
        self.assertEqual([r["keyword"] for r in rows], ["MUST NOT", "MUST", "SHALL", "SHOULD NOT"])
        self.assertEqual(rows[0]["contextEndLine"], 6)
        self.assertEqual(rows[1]["disposition"], "example")
        self.assertEqual(rows[2]["heading"], ["Example", "Next"])
        self.assertEqual(len({r["id"] for r in rows}), 4)

    def test_sources_and_pending_legacy_seeds_reproduce(self):
        actual = json.loads((ROOT / "conformance/requirements.json").read_text(encoding="utf-8"))
        self.assertEqual(load("generate-requirements").generate(), actual)
        self.assertEqual(len(actual["keywordAudit"]), 443)
        self.assertEqual(sum(e["keyword"] in ("MUST", "MUST NOT") for e in actual["keywordAudit"]), 242)
        seeds = actual["requirements"][:31]
        self.assertTrue(all(r["status"] in ("blocked", "unimplemented") for r in seeds))
        ids = {r["id"] for r in seeds}
        for path in (ROOT / "conformance/vectors").glob("*.json"):
            self.assertIn(json.loads(path.read_text(encoding="utf-8"))["requirement"], ids)

    def test_api_review_keeps_absent_interfaces_and_adoption_pending(self):
        actual = json.loads((ROOT / "specs/errata/api-editorial-0.1.json").read_text(encoding="utf-8"))
        self.assertEqual(load("generate-api-review").generate(), actual)
        self.assertEqual(sum(r["status"] == "missing-interface" for r in actual["requiredTools"]), 3)
        self.assertFalse(actual["accepted"])
