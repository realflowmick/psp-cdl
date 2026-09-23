# SPDX-License-Identifier: Apache-2.0
import json
import sys
from mediation_fixtures import MediationFixture
from psp_cdl_mcp_server.stdio import serve_stdio

if sys.argv[1] == "--proxy":
    executable, script, spy, config = sys.argv[2:6]
    f = MediationFixture(json.loads(config),executable,script,spy)
    try: serve_stdio(f.server)
    finally: f.close()
