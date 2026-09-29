# SPDX-License-Identifier: Apache-2.0
from pathlib import Path
import json
import sys
sys.path.insert(0,str(Path(__file__).resolve().parents[3]/'scripts'))
from context_service_fixtures import SUITE, run_case
for name in ('model-selects-help','host-denies-then-model-chooses-alternative','checkpoint-resume-rehydrates'):
    result=run_case(next(c for c in SUITE['cases'] if c['id']==name))
    print(json.dumps({'id':name,**{k:result[k] for k in ('code','calls','node','version','status','events')}},separators=(',',':')))
