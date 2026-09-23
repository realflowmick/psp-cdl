# SPDX-License-Identifier: Apache-2.0
"""Compare actual provider/tool calls, buffered release and provider-visible transcripts."""
import json
import subprocess
from pathlib import Path
from llm_fixtures import SUITE, run_case

ROOT = Path(__file__).resolve().parents[1]
source = "import {suite,runCase} from './scripts/llm-fixtures.mjs'; const out=[]; for(const c of suite.cases)out.push(await runCase(c)); console.log(JSON.stringify(out));"
peer = subprocess.run(["node", "--input-type=module", "-e", source], cwd=ROOT, check=True, capture_output=True, text=True, encoding="utf-8")
ts = json.loads(peer.stdout)
for case, actual in zip(SUITE["cases"], ts, strict=True):
    py = run_case(case)
    if py != actual: raise SystemExit(case["id"]+": LLM parity mismatch\n"+str(py)+"\n"+str(actual))
    for key, expected in case["expected"].items():
        if actual[key] != expected: raise SystemExit(case["id"]+": "+str(actual))
print(f"{len(ts)} shared buffered loop cases agree, including calls, released output, provenance and provider-visible transcripts.")
