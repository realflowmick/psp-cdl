# SPDX-License-Identifier: Apache-2.0
"""Run from the checkout; all host credentials/data are synthetic."""
import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/"scripts"))
from dispatch_fixtures import Fixture
from psp_cdl_mcpproxy import DispatchError
f = Fixture()
try:
    print(f.gate.list_tools("test-owner",f.session["sessionId"],f.options))
    request = {"name":"echo.read", "arguments":{"message":"hello 🧪"}}
    print(f.gate.call_tool("test-owner",f.session["sessionId"],request,f.options))
    f.flags["policyDeny"] = True
    try: f.gate.call_tool("test-owner",f.session["sessionId"],request,f.options)
    except DispatchError as exc: print({"denied":exc.code, "calls":f.calls})
finally:
    f.close()
