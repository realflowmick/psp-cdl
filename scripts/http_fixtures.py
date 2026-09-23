# SPDX-License-Identifier: Apache-2.0
"""Synthetic HTTP authorities, SQLite sessions and tool spies."""
import json
from pathlib import Path
from dispatch_fixtures import Fixture, SUITE as GATE_SUITE
from psp_cdl_api_server.persistence import WorkflowStore
from psp_cdl_api_server.sqlite import SqliteBackend
from psp_cdl_mcpproxy import McpDispatchGate
from psp_cdl_mcpproxy.mcp import create_mcp_proxy_service
from psp_cdl_mcp_server.http import McpHttpServer
from urllib.parse import urlsplit

SUITE = json.loads((Path(__file__).resolve().parents[1]/"conformance/vectors/dispatch/http-0.1.json").read_text(encoding="utf-8"))
INITIALIZE = {"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"fixture","version":"1"}}}
CALL = {"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"echo.read","arguments":{"message":"hello 🧪"}}}
APPROVAL = {"name":"read","revision":"tool-1","readOnly":True,"complete":True,"sources":[],"inputSchema":GATE_SUITE["schema"],"outputSchema":GATE_SUITE["schema"]}
def config(endpoint): return {"endpoint":endpoint,"allowLoopbackHttp":True,"authorizationServers":["https://issuer.example/"],"maxSessions":8,"sessionTtlMs":60000,"callTimeoutMs":2000}
def request(endpoint,message,sid=None,extra=None):
    return {"method":"POST","path":"/mcp","headers":[["host",urlsplit(endpoint).netloc],["authorization","Bearer test-owner"],["content-type","application/json"],["accept","application/json, text/event-stream"],["mcp-protocol-version","2025-11-25"],*([["mcp-session-id",sid]] if sid else [])],"body":json.dumps(message,ensure_ascii=False).encode("utf-8"),**(extra or {})}

class HttpFixture:
    def __init__(self, endpoint="http://127.0.0.1:8123/mcp",settings=None,overrides=None):
        self.f,self.endpoint = Fixture(settings),endpoint
        self.adapter = McpHttpServer(self,{**config(endpoint),**(overrides or {})})
    def authenticate(self, token, resource): return self.f.authenticate(token) if resource == self.endpoint else None
    def open(self, principal, cancelled):
        # SQLite connections belong to this request's worker; all gates share owner coordination.
        f = self.f
        backend = SqliteBackend(str(Path(f.directory.name)/"state.sqlite"),"epoch-1",f.now)
        store = WorkflowStore(backend,resume_secret=bytes([7])*32,authorize_persistence=lambda *_:True,coordinator=f.coordinator)
        gate = McpDispatchGate(store,f,"registry-1",[{**APPROVAL,"server":"echo","invoke":f.invoke}])
        service = create_mcp_proxy_service(gate,f.session["sessionId"],lambda:{**f.options,"cancelled":lambda:cancelled() or f.options["cancelled"]()})
        return {"service":service,"close":backend.close}
    def close(self):
        self.adapter.close()
        self.f.close()

def run_http_case(c):
    endpoint = "http://127.0.0.1:8123/mcp"
    f = HttpFixture(endpoint,c.get("settings"))
    try:
        init = f.adapter.handle(request(endpoint,INITIALIZE))
        sid = init["headers"]["mcp-session-id"]
        f.adapter.handle(request(endpoint,{"jsonrpc":"2.0","method":"notifications/initialized"},sid))
        r = request(endpoint,c.get("message",CALL),None if c.get("missingSession") else sid,c.get("http"))
        for name,value in c.get("headers",{}).items():
            r["headers"] = [[k,v] for k,v in r["headers"] if k!=name]
            if value is not None: r["headers"].append([name,value])
        if c.get("duplicate"): r["headers"].append(["Authorization","Bearer test-owner"])
        if "raw" in c: r["body"] = c["raw"].encode("utf-8")
        if c.get("oversize"): r["body"] = bytes(1_048_577)
        response = f.adapter.handle(r)
        body = json.loads(response["body"]) if response["body"] else {}
        error,result = body.get("error",{}),body.get("result",{})
        code = error.get("code",error.get("message","OK"))
        if result.get("isError"): code = json.loads(result["content"][0]["text"])["error"]["code"]
        return {"status":response["status"],"code":code,"calls":f.f.calls,"released":int("structuredContent" in result)}
    finally: f.close()
