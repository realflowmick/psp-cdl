# SPDX-License-Identifier: Apache-2.0
import json
import subprocess
import sys
import tempfile
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/"scripts"))
from dispatch_fixtures import Fixture
from http_fixtures import APPROVAL
from psp_cdl_mcpproxy import McpDispatchGate
from psp_cdl_mcpproxy.mcp import HttpMcpClient

with tempfile.TemporaryDirectory(prefix="psp-http-example-") as directory:
    child=subprocess.Popen([sys.executable,str(ROOT/"scripts/http_peer.py"),json.dumps({"mode":"sse","spy":str(Path(directory)/"spy")})],stdin=subprocess.PIPE,stdout=subprocess.PIPE,text=True,encoding="utf-8")
    peer=f=None
    try:
        endpoint=child.stdout.readline().strip()
        peer=HttpMcpClient.connect({"endpoint":endpoint,"allowLoopbackHttp":True,"serverInfo":{"name":"psp-cdl-reference","version":"0.1.0"},"timeoutMs":2000},lambda _:"test-downstream")
        f=Fixture()  # Synthetic SQLite workflow, host policies and owner coordination.
        gate=McpDispatchGate(f.store,f,"registry-1",peer.registrations("echo",[APPROVAL],f.now))
        print(json.dumps(gate.call_tool("test-owner",f.session["sessionId"],{"name":"echo.read","arguments":{"message":"hello 🧪"}},f.options),ensure_ascii=False,indent=2))
    finally:
        if peer: peer.close()
        if f: f.close()
        child.stdin.close()
        child.wait(timeout=5)
        child.stdout.close()
