# SPDX-License-Identifier: Apache-2.0
"""Actual MCP client/proxy/downstream process chains in both language directions."""
import json
import subprocess
import sys
import tempfile
from pathlib import Path
from mediation_fixtures import SUITE, run_mediation_case, messages, summarize

ROOT = Path(__file__).resolve().parents[1]
def run(args, **kwargs): return subprocess.run(args,cwd=ROOT,check=True,capture_output=True,text=True,encoding="utf-8",timeout=120,**kwargs).stdout
peer = json.loads(run(["node","scripts/mediation-probe.mjs","--report"]))
for case, ts in zip(SUITE["cases"],peer,strict=True):
    py = run_mediation_case(case)
    assert py == ts,(case["id"],py,ts)
    for k,v in case["expected"].items(): assert py[k] == v,(case["id"],py)
print(f'{len(peer)} MCP mediation scenarios agree across actual downstream processes.')
with tempfile.TemporaryDirectory(prefix="psp-wire-") as directory:
    for case in [c for c in SUITE["cases"] if c["id"] in ("successful-round-trip","dispatch-policy-denies","release-policy-denies","node-affinity-denies","discovery-drift-before","discovery-drift-after","unvalidated-text","metadata-grants-no-authority","method-is-not-forwarded")]:
        spy = Path(directory)/case["id"]
        wire = "\n".join(json.dumps(m,ensure_ascii=False) for m in messages(case))+"\n"
        output = run(["node","scripts/mediation-probe.mjs","--proxy",sys.executable,str(ROOT/"scripts/mediation_peer.py"),str(spy),json.dumps(case,ensure_ascii=False)],input=wire)
        report = summarize([json.loads(line) for line in output.splitlines()],len(spy.read_text().splitlines()) if spy.exists() else 0)
        for k,v in case["expected"].items(): assert report[k] == v,(case["id"],report)
        assert "PRIVATE_" not in output
print("Python client -> Node proxy -> Python downstream passed nine real stdio chains.")
print(run(["node","scripts/mediation-probe.mjs","--python-proxy",sys.executable]).strip())
