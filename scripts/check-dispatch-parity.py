# SPDX-License-Identifier: Apache-2.0
"""Compare actual gate results and tool-spy counters, including provenance digests."""
import json
import subprocess
from pathlib import Path
from dispatch_fixtures import SUITE, run_case

ROOT = Path(__file__).resolve().parents[1]
source = "import {suite,runCase} from './scripts/dispatch-fixtures.mjs'; console.log(JSON.stringify(await Promise.all(suite.cases.map(runCase))));"
peer = subprocess.run(["node","--input-type=module","-e",source],cwd=ROOT,check=True,capture_output=True,text=True,encoding="utf-8")
ts = json.loads(peer.stdout)
for case, actual in zip(SUITE["cases"],ts,strict=True):
    py = run_case(case)
    if py != actual: raise SystemExit(case["id"]+": cross-language dispatch mismatch\n"+str(py)+"\n"+str(actual))
    for k,v in case["expected"].items():
        if actual[k] != v: raise SystemExit(case["id"]+": "+str(actual))
print(f"{len(ts)} shared dispatch cases agree, including downstream calls, suppressed output and provenance. No transport/full-proxy conformance claimed.")
