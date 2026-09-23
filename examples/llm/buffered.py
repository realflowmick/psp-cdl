# SPDX-License-Identifier: Apache-2.0
import json
import sys
from pathlib import Path
sys.stdout.reconfigure(encoding="utf-8")
sys.path.insert(0, str(Path(__file__).resolve().parents[2]/"scripts"))
from llm_fixtures import run_case
for settings in ({}, {"providerTraining":True}):
    result = run_case({"settings":settings})
    print(json.dumps({k:v for k,v in result.items() if k not in ("requests", "phases", "busy")}, ensure_ascii=False))
