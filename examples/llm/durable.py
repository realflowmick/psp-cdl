# SPDX-License-Identifier: Apache-2.0
"""Synthetic fixture only; no live provider or credentials."""
import json
import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/"scripts"))
from durable_fixtures import SUITE, run_case
for name in ("lockdown-before-provider","failAfterCommit","retained-origin-denies-recovery"):
    actual=run_case(next(c for c in SUITE["cases"] if c["id"]==name))
    print(json.dumps({"scenario":name,**{k:actual[k] for k in ("codes","providerCalls","status","released")}}))
