# SPDX-License-Identifier: Apache-2.0
"""Compare exact observer event sequences and digest-level data across both languages."""
import json
import subprocess
from pathlib import Path
from observer_fixtures import SUITE, run_case

ROOT = Path(__file__).resolve().parents[1]
source = "import {suite,runCase} from './scripts/observer-fixtures.mjs'; const out=[]; for(const c of suite.cases)out.push(await runCase(c)); console.log(JSON.stringify(out));"
peer = subprocess.run(["node", "--input-type=module", "-e", source], cwd=ROOT, check=True, capture_output=True, text=True, encoding="utf-8")
ts = json.loads(peer.stdout)
for case, actual in zip(SUITE["cases"], ts, strict=True):
    py = run_case(case)
    if py != actual: raise SystemExit(case["id"]+": observer parity mismatch\n"+ascii(py)+"\n"+ascii(actual))
    for key, expected in case["expected"].items():
        if actual[key] != expected: raise SystemExit(case["id"]+": "+key+" expected "+repr(expected)+" actual "+ascii(actual[key]))
print(f"{len(ts)} shared observer cases agree, including event order, sizes, decisions and inspect payloads. Observation is development telemetry, not evidence.")
