# SPDX-License-Identifier: Apache-2.0
import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/"scripts"))
from mediation_fixtures import run_mediation_case
print(run_mediation_case({"id":"permitted"}))
print(run_mediation_case({"id":"denied","settings":{"policyDeny":True}}))
