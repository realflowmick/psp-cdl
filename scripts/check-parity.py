# SPDX-License-Identifier: Apache-2.0
"""Verify paired metadata, executed library profiles and actual two-way interchange."""
import importlib
import json
import subprocess
import sys
from pathlib import Path
from library_exchange import emit_bundle, verify_bundle

ROOT = Path(__file__).resolve().parents[1]
subprocess.run([sys.executable, "scripts/check-requirements.py"], cwd=ROOT, check=True)
subprocess.run([sys.executable, "scripts/generate-api-review.py", "--check"], cwd=ROOT, check=True)
project = json.loads((ROOT / "project.json").read_text(encoding="utf-8"))
for component in project["components"]:
    module_uri = (ROOT / component["typescript"] / "dist/index.js").as_uri()
    code = "import { manifest } from " + json.dumps(module_uri) + "; console.log(JSON.stringify(manifest));"
    result = subprocess.run(["node", "--input-type=module", "-e", code], check=True, capture_output=True, text=True, encoding="utf-8", cwd=ROOT)
    ts = json.loads(result.stdout)
    py = importlib.import_module("psp_cdl_" + component["id"].replace("-", "_")).get_manifest()
    if ts != py:
        raise SystemExit("Metadata differs for " + component["id"])
for args in ([], ["--inventory"], ["--profiles"]):
    ts = subprocess.run(["node", "implementations/typescript/packages/test-harness/dist/cli.js", *args], cwd=ROOT, capture_output=True, text=True, encoding="utf-8")
    py = subprocess.run([sys.executable, "-m", "psp_cdl_test_harness", *args], cwd=ROOT, capture_output=True, text=True, encoding="utf-8")
    expected = 0 if args else 2
    if ts.returncode != expected or py.returncode != expected:
        raise SystemExit("Harness status mismatch: " + ts.stderr + py.stderr)
    if json.loads(ts.stdout) != json.loads(py.stdout):
        raise SystemExit("Harness output differs across languages")
peer = subprocess.run(["node", "scripts/library-exchange.mjs", "--emit"], check=True, capture_output=True, text=True, encoding="utf-8", cwd=ROOT)
verify_bundle(json.loads(peer.stdout))
result = subprocess.run(["node", "scripts/library-exchange.mjs", "--verify"], input=json.dumps(emit_bundle(), ensure_ascii=False), check=True, capture_output=True, text=True, encoding="utf-8", cwd=ROOT)
print(result.stdout.strip())
subprocess.run([sys.executable,"scripts/check-service-parity.py"],cwd=ROOT,check=True)
subprocess.run([sys.executable,"scripts/check-persistence-parity.py"],cwd=ROOT,check=True)
subprocess.run([sys.executable,"scripts/check-workflow-parity.py"],cwd=ROOT,check=True)
subprocess.run([sys.executable,"scripts/check-dispatch-parity.py"],cwd=ROOT,check=True)
subprocess.run([sys.executable,"scripts/check-mediation-parity.py"],cwd=ROOT,check=True)
subprocess.run([sys.executable,"-u","scripts/check-http-parity.py"],cwd=ROOT,check=True)
subprocess.run([sys.executable,"-u","scripts/check-revision-parity.py"],cwd=ROOT,check=True)
subprocess.run([sys.executable,"scripts/check-llm-parity.py"],cwd=ROOT,check=True)
subprocess.run([sys.executable,"scripts/check-durable-parity.py"],cwd=ROOT,check=True)
subprocess.run([sys.executable,"scripts/check-refresh-parity.py"],cwd=ROOT,check=True)
subprocess.run([sys.executable,"scripts/check-mcp-refresh-parity.py"],cwd=ROOT,check=True)
subprocess.run([sys.executable,"scripts/check-redirect-parity.py"],cwd=ROOT,check=True)
subprocess.run([sys.executable,"scripts/check-scoped-parity.py"],cwd=ROOT,check=True)
subprocess.run([sys.executable,"scripts/check-provider-parity.py"],cwd=ROOT,check=True)
subprocess.run([sys.executable,"scripts/check-provider-http.py"],cwd=ROOT,check=True)
print("Seven manifests and three harness modes agree; library profiles and both interchange directions passed. Full workflow conformance is pending.")
