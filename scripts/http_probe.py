# SPDX-License-Identifier: Apache-2.0
import json
import sys
from pathlib import Path
from http_fixtures import SUITE, run_http_case, APPROVAL
from dispatch_fixtures import Fixture
from psp_cdl_mcpproxy import McpDispatchGate
from psp_cdl_mcpproxy.mcp import HttpMcpClient

def probe(c):
    peer=f=None
    try:
        def credential(resource):
            assert resource==c["endpoint"]
            return c.get("token","test-downstream")
        peer=HttpMcpClient.connect({"endpoint":c["endpoint"],"allowLoopbackHttp":not c.get("rejectHttp",False),"serverInfo":{"name":"psp-cdl-reference","version":"0.1.0"},"timeoutMs":700,**({"caPem":Path(c["ca"]).read_text()} if c.get("ca") else {})},credential)
        f=Fixture(c.get("settings"))
        gate=McpDispatchGate(f.store,f,"registry-1",peer.registrations("echo",[APPROVAL],f.now))
        cancelled=lambda:bool(c.get("cancel") and Path(c["spy"]).exists() and "call" in Path(c["spy"]).read_text())
        result=gate.call_tool("test-owner",f.session["sessionId"],{"name":"echo.read","arguments":{"message":"hello 🧪"}},{"deadline":1800,"cancelled":cancelled})
        return {"code":"OK","released":1,"data":result["data"],"trustLevel":result["provenance"]["trustLevel"]}
    except Exception as exc: return {"code":getattr(exc,"code","UNEXPECTED_ERROR"),"released":0}
    finally:
        if peer: peer.close()
        if f: f.close()

if __name__=="__main__":
    print(json.dumps([run_http_case(c) for c in SUITE["cases"]] if sys.argv[1]=="--report" else probe(json.loads(sys.argv[1])),ensure_ascii=False))
