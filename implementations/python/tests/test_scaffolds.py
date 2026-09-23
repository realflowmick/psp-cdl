# SPDX-License-Identifier: Apache-2.0
import importlib
import json
import subprocess
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
PROJECT = json.loads((ROOT / "project.json").read_text(encoding="utf-8"))


class ScaffoldTests(unittest.TestCase):
    def test_components_advertise_scoped_features_and_reject_whole_workflows(self):
        for component in PROJECT["components"]:
            with self.subTest(component=component["id"]):
                mod = importlib.import_module("psp_cdl_" + component["id"].replace("-", "_"))
                manifest = mod.get_manifest()
                self.assertEqual(manifest["id"], component["id"])
                implemented = component["id"] in {"core", "cdl", "test-harness", "api-server", "mcp-server", "mcpproxy", "llmproxy"}
                self.assertEqual(manifest["status"], "experimental" if implemented else "scaffold")
                self.assertEqual(bool(manifest["implementedFeatures"]), implemented)
                self.assertEqual(manifest["specifications"], PROJECT["specifications"])
                with self.assertRaises(mod.NotImplementedFeatureError) as result:
                    mod.require_implementation()
                self.assertEqual(result.exception.code, "NOT_IMPLEMENTED")

    def test_manifest_cannot_be_changed_by_caller(self):
        mod = importlib.import_module("psp_cdl_core")
        manifest = mod.get_manifest()
        manifest["implementedFeatures"].append("unsafe-claim")
        self.assertNotIn("unsafe-claim", mod.get_manifest()["implementedFeatures"])

    def test_unimplemented_harness_does_not_succeed(self):
        result = subprocess.run([sys.executable, "-m", "psp_cdl_test_harness"], cwd=ROOT, capture_output=True, text=True)
        self.assertEqual(result.returncode, 2, result.stderr)
        report = json.loads(result.stdout)
        self.assertEqual(report["executed"], 0)
        self.assertEqual(report["passed"], 0)

    def test_inventory_is_not_execution(self):
        result = subprocess.run([sys.executable, "-m", "psp_cdl_test_harness", "--inventory"], cwd=ROOT, capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout)["executed"], 0)


if __name__ == "__main__":
    unittest.main()
