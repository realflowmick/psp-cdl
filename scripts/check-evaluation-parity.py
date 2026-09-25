# SPDX-License-Identifier: Apache-2.0
"""Four actual process combinations, fixed synthetic records and observable effects."""
import json
import shutil
import subprocess
import sys
from evaluation_fixtures import ROOT, SUITE, run_case

node = shutil.which("node")
if not node: raise SystemExit("Node runtime required")
reports = []
for language, executable, script in (("typescript", node, ROOT / "scripts/evaluation-server.mjs"),
                                     ("python", sys.executable, ROOT / "scripts/evaluation_server.py")):
    result = subprocess.run([node, "scripts/evaluation-fixtures.mjs", executable, str(script)], cwd=ROOT,
                            check=True, capture_output=True, text=True, encoding="utf-8", timeout=120)
    ts = json.loads(result.stdout)
    py = [run_case(case, executable, str(script)) for case in SUITE["cases"]]
    assert ts == py, (language, ts, py)
    for case, actual in zip(SUITE["cases"], py, strict=True):
        for key, expected in case["expected"].items():
            assert actual[key] == expected, (language, case["id"], key, actual[key], expected)
        assert [e["sequence"] for e in actual["events"]] == list(range(1, len(actual["events"])+1))
        assert all(e["correlation"] == case["id"] for e in actual["events"])
    reports.append(py)
    print(f"Both proxy languages -> {language} fixture: {len(py)} scenarios passed with actual spy events.", flush=True)
assert reports[0] == reports[1], "Fixture language behavior differs"
print("60 isolated process scenarios passed; bypass exported the synthetic canary as expected. No model/effectiveness measurement.")
