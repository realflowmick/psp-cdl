# SPDX-License-Identifier: Apache-2.0
"""Host input only: no rubric, approval document or full corpus crosses this boundary."""
import sys
from psp_cdl_core import parse_json, canonical_json
from study_adapter import run_trial
from pathlib import Path
from psp_cdl_test_harness import validate_pilot_observation

try:
    data = sys.stdin.buffer.read(131073)
    if len(data) > 131072: raise ValueError()
    payload = parse_json(data.decode('utf-8'))
    if set(payload) != {'config','input'}: raise ValueError()
    observation = validate_pilot_observation(run_trial(payload['config'],payload['input']))
    result = {'trialId':payload['config']['trialId'],'observation':observation}
    with Path(payload['config']['observationFile']).open('xb') as target:
        target.write((canonical_json(result)+'\n').encode('utf-8'))
except Exception:
    print('{"error":"ADAPTER_ERROR"}')
    raise SystemExit(1)
