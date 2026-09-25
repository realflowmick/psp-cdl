# SPDX-License-Identifier: Apache-2.0
"""Check reproducibility and execute the exact linked library evidence in both runtimes."""
import importlib.util
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("requirements", ROOT / "scripts/generate-requirements.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
data = json.loads((ROOT / "conformance/requirements.json").read_text(encoding="utf-8"))
assert data == module.generate(), "Stale requirement inventory"
for evidence in data["evidence"].values():
    for path in evidence["implementation"]:
        assert (ROOT / path).is_file(), path
for command in (["node", "implementations/typescript/packages/test-harness/dist/cli.js", "--profiles"],
                [sys.executable, "-m", "psp_cdl_test_harness", "--profiles"]):
    result = subprocess.run(command, cwd=ROOT, check=True, capture_output=True, text=True, encoding="utf-8", timeout=60)
    report = json.loads(result.stdout)
    passed = {r["caseId"] for r in report["results"] if r["status"] == "passed"}
    for evidence in data["evidence"].values():
        assert set(evidence["cases"]) <= passed, set(evidence["cases"]) - passed
print("Linked profile evidence executed in both languages; RFC clause/seed status remains pending.")
