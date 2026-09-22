# SPDX-License-Identifier: Apache-2.0
"""Verify scaffold metadata/CLI parity; this is not protocol conformance."""
import importlib
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
project = json.loads((ROOT / "project.json").read_text(encoding="utf-8"))
for component in project["components"]:
    module_uri = (ROOT / component["typescript"] / "dist/index.js").as_uri()
    code = "import { manifest } from " + json.dumps(module_uri) + "; console.log(JSON.stringify(manifest));"
    result = subprocess.run(["node", "--input-type=module", "-e", code], check=True, capture_output=True, text=True, cwd=ROOT)
    ts = json.loads(result.stdout)
    py = importlib.import_module("psp_cdl_" + component["id"].replace("-", "_")).get_manifest()
    if ts != py:
        raise SystemExit("Metadata differs for " + component["id"])
for args in ([], ["--inventory"]):
    ts = subprocess.run(["node", "implementations/typescript/packages/test-harness/dist/cli.js", *args], cwd=ROOT, capture_output=True, text=True)
    py = subprocess.run([sys.executable, "-m", "psp_cdl_test_harness", *args], cwd=ROOT, capture_output=True, text=True)
    expected = 0 if args else 2
    if ts.returncode != expected or py.returncode != expected:
        raise SystemExit("Harness status mismatch: " + ts.stderr + py.stderr)
    if json.loads(ts.stdout) != json.loads(py.stdout):
        raise SystemExit("Harness output differs across languages")
print("Seven component manifests and both harness modes agree. No protocol conformance was executed.")
