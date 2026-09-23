# SPDX-License-Identifier: Apache-2.0
import json
import os
import sys
import tempfile
from pathlib import Path
from copy import deepcopy
from dispatch_fixtures import Fixture, SUITE as DISPATCH_SUITE
from psp_cdl_mcpproxy import McpDispatchGate
from psp_cdl_mcpproxy.mcp import StdioMcpClient, create_mcp_proxy
from psp_cdl_mcp_server import MCP_VERSION

SUITE = json.loads((Path(__file__).resolve().parents[1]/"conformance/vectors/dispatch/stdio-0.1.json").read_text(encoding="utf-8"))


def messages(c=None):
    c = c or {}
    return [
        {"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":MCP_VERSION,"capabilities":{},"clientInfo":{"name":"test-client","version":"1"}}},
        {"jsonrpc":"2.0","method":"notifications/initialized"},
        {"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}},
        {"jsonrpc":"2.0",**({} if c.get("notification") else {"id":3}),"method":c.get("method","tools/call"),"params":c.get("request",{"name":"echo.read","arguments":{"message":"x"*250000 if c.get("largeRequest") else "hello 🧪"}})}]


def summarize(replies,calls):
    r = next((r for r in replies if r["id"] == 3),None)
    result = r.get("result") if r else None
    code = "NO_REPLY" if r is None else r["error"]["message"] if "error" in r else json.loads(result["content"][0]["text"])["error"]["code"] if result.get("isError") else "OK"
    return {"code":code,"calls":calls,"released":int(code=="OK"),**({"result":result} if code=="OK" else {})}


class MediationFixture:
    def __init__(self,c=None,executable=None,script=None,spy=None):
        c = c or {}
        self.f, self.peer = Fixture(c.get("settings")), None
        self.directory = None if spy else tempfile.TemporaryDirectory(prefix="psp-peer-")
        self.spy = Path(spy) if spy else Path(self.directory.name)/"calls"
        try:
            self.peer = StdioMcpClient.connect({"executable":executable or sys.executable,"args":[str(script or Path(__file__).with_name("mediation_peer.py")),c.get("mode","normal"),str(self.spy)],"env":{**({"SystemRoot":os.environ["SystemRoot"]} if "SystemRoot" in os.environ else {}),"PSP_TEST_CREDENTIAL":c.get("downstreamToken","test-downstream")},"serverInfo":{"name":"psp-cdl-reference","version":"0.1.0"},"timeoutMs":2000})
            approval = {"name":"read","revision":"1","readOnly":not c.get("mutating"),"sources":[{"id":"host-approved-endpoint","capabilities":[]}],"complete":True,"inputSchema":deepcopy(DISPATCH_SUITE["schema"]),"outputSchema":deepcopy(DISPATCH_SUITE["schema"])}
            if c.get("mode") == "write-hang":
                for s in (approval["inputSchema"],approval["outputSchema"]): s["properties"]["message"]["maxLength"] = 300000
            if c.get("mismatch"): approval["inputSchema"]["properties"]["message"]["maxLength"] = 31
            registrations = self.peer.registrations("echo",[approval],lambda:self.f.flags["now"])
            self.gate = McpDispatchGate(self.f.store,self.f,"registry-1",registrations)
            self.server = create_mcp_proxy(self.gate,lambda:c.get("token","test-owner"),self.f.session["sessionId"],lambda:self.f.options)
        except Exception:
            self.close()
            raise
    def calls(self): return len(self.spy.read_text(encoding="utf-8").splitlines()) if self.spy.exists() else 0
    def close(self):
        if self.peer: self.peer.close()
        self.f.close()
        if self.directory: self.directory.cleanup()


def run_mediation_case(c):
    f = None
    try:
        f = MediationFixture(c)
        replies = [r for m in messages(c) if (r:=f.server.handle(json.dumps(m,ensure_ascii=False))) is not None]
        return summarize(replies,f.calls())
    except Exception as exc: return {"code":getattr(exc,"code","UNEXPECTED_ERROR"),"calls":f.calls() if f else 0,"released":0}
    finally:
        if f: f.close()
