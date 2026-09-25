# SPDX-License-Identifier: Apache-2.0
"""Compare actual offline provider requests, tool dispatch and released results."""
import json
import subprocess
from pathlib import Path
from provider_fixtures import SUITE, run_case

ROOT = Path(__file__).resolve().parents[1]
source = "import {suite,runCase} from './scripts/provider-fixtures.mjs'; const out=[]; for(const c of suite.cases)out.push(await runCase(c)); console.log(JSON.stringify(out));"
peer = subprocess.run(["node", "--input-type=module", "-e", source], cwd=ROOT, check=True, capture_output=True, text=True, encoding="utf-8")
reports = json.loads(peer.stdout)
for case, actual in zip(SUITE["cases"], reports, strict=True):
    py = run_case(case)
    if py != actual: raise SystemExit(case["id"]+": provider parity mismatch\n"+str(py)+"\n"+str(actual))
    for key, expected in case["expected"].items():
        if actual[key] != expected: raise SystemExit(case["id"]+": "+str(actual))
print(f"{len(reports)} shared offline provider cases agree, including wire requests, budgets, loop boundaries and suppressed output. Live smoke: NOT RUN.")
