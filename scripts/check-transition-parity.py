# SPDX-License-Identifier: Apache-2.0
"""Compare actual public transition API output and error codes in both languages."""
import json
from pathlib import Path
import subprocess
import sys
from psp_cdl_core import PspError, select_transition

ROOT = Path(__file__).resolve().parents[1]
subprocess.run([sys.executable, "scripts/generate-transition-vectors.py", "--check"], cwd=ROOT, check=True)
cases = json.loads((ROOT / "conformance/vectors/transitions/profile-0.1.json").read_text(encoding="utf-8"))["cases"]
js = """
import {readFileSync} from 'node:fs';
import {selectTransition} from './implementations/typescript/packages/core/dist/index.js';
const cases=JSON.parse(readFileSync(0,'utf8'));
console.log(JSON.stringify(cases.map(c=>{try{return {result:selectTransition(c.request)};}catch(e){return {error:e.code??e.name};}})));
"""
peer = subprocess.run(["node", "--input-type=module", "-e", js], input=json.dumps(cases),
                      cwd=ROOT, capture_output=True, text=True, encoding="utf-8", check=True)
actual = []
for case in cases:
    try:
        actual.append({"result": select_transition(case["request"])})
    except PspError as error:
        actual.append({"error": error.code})
expected = [c["expected"] for c in cases]
if actual != expected or json.loads(peer.stdout) != expected:
    for case, py, ts in zip(cases, actual, json.loads(peer.stdout)):
        if py != case["expected"] or ts != case["expected"]:
            print(case["id"], "Python:", py, "TypeScript:", ts, "expected:", case["expected"])
    raise SystemExit("Transition parity failed")
print(f"{len(cases)} shared transition results and errors agree")
