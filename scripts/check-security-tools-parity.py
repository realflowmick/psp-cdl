# SPDX-License-Identifier: Apache-2.0
"""Actual bidirectional HTTP/stdio workflow mutations plus shared scenario parity."""
import json
import subprocess
import sys
import threading
import queue
import urllib.request
from pathlib import Path
from wsgiref.simple_server import make_server, WSGIRequestHandler
from security_tools_fixtures import SUITE, CombinedFixture as Fixture, Fixture as SecurityFixture, run_case
from psp_cdl_api_server.http import create_wsgi_app
ROOT = Path(__file__).resolve().parents[1]

def run(args):
    p = subprocess.run(args,cwd=ROOT,capture_output=True,text=True,encoding="utf-8",timeout=60)
    assert p.returncode == 0, p.stdout+p.stderr
    return p.stdout

peer = json.loads(run(["node","scripts/security-tools-probe.mjs","--report"]))
local = [{"id":c["id"],"results":run_case(c)} for c in SUITE["cases"]]
assert peer == local

def flow(call):
    for c in (c for c in SUITE["cases"] if not c["flags"] and c["expect"]["status"]==200):
        result=call("security/"+c["operation"],SecurityFixture(c).request)
        if "errors" in c["expect"]:assert [r.get("error") for r in result["results"]]==c["expect"]["errors"],(c["id"],result)
        if "contents" in c["expect"]:assert [r.get("content") for r in result["results"]]==c["expect"]["contents"],c["id"]
        if "success" in c["expect"]:assert result["success"]==c["expect"]["success"]
    verified=call("security/verify",{"operation_id":"op-1","sections":[{"id":"one","content":SUITE["contents"]["@plain"]}]})
    assert verified["summary"]["valid"]==1
    created=call("sessions/create",{"requestId":"wire-create","nodeId":"entry","nodeVersion":"1","expiresAt":1900,"state":{"stage":"created"}})
    sid=created["result"]["sessionId"]
    assert any(s["sessionId"]==sid for s in call("sessions/list",{"after":None,"limit":50,"status":"all"})["result"]["sessions"])
    call("nodes/fetch",{"nodeId":"entry","nodeVersion":"1"})
    call("sessions/update",{"requestId":"wire-update","sessionId":sid,"expectedVersion":1,"nodeId":"next","nodeVersion":"1","status":"running","state":{"stage":"saved"}})
    checkpoint=call("checkpoints/create",{"requestId":"wire-pause","sessionId":sid,"expectedVersion":2,"expiresAt":1500})
    call("checkpoints/resume",{"requestId":"wire-resume","checkpointId":checkpoint["result"]["checkpointId"],"state":{"stage":"resumed"}})
    assert call("sessions/get",{"sessionId":sid})["result"]["version"]==4

class QuietHandler(WSGIRequestHandler):
    def log_message(self,*args): pass
    def setup(self):
        super().setup()
        self.connection.settimeout(5)

ready = queue.Queue()
def serve():
    # SQLite connections belong to the worker that uses them.
    f = Fixture()
    server = make_server("127.0.0.1",0,create_wsgi_app(f.service),handler_class=QuietHandler)
    ready.put(server)
    try: server.serve_forever()
    finally: server.server_close();f.close()
thread = threading.Thread(target=serve,daemon=True)
thread.start()
server = ready.get(timeout=10)
try:
    print(run(["node","scripts/security-tools-probe.mjs","--http-client","http://127.0.0.1:"+str(server.server_port)]).strip())
finally:
    server.shutdown();thread.join(timeout=5)

process = subprocess.Popen(["node","scripts/security-tools-probe.mjs","--http-server"],cwd=ROOT,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,encoding="utf-8")
timer = threading.Timer(30,process.kill);timer.start()
try:
    port = int(process.stdout.readline())
    def http(route,args):
        request = urllib.request.Request("http://127.0.0.1:"+str(port)+"/v1/"+route,data=json.dumps(args).encode(),headers={"authorization":"Bearer test-owner","content-type":"application/json"})
        with urllib.request.urlopen(request,timeout=5) as response:
            assert response.status == 200
            return json.load(response)
    flow(http)
finally:
    process.communicate(timeout=10);timer.cancel()
    assert process.returncode == 0

print(run(["node","scripts/security-tools-probe.mjs","--python-stdio",sys.executable]).strip())
process = subprocess.Popen(["node","scripts/security-tools-probe.mjs","--stdio"],cwd=ROOT,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,encoding="utf-8")
timer = threading.Timer(30,process.kill);timer.start()
sequence = 0
try:
    def rpc(method,params):
        global sequence
        sequence += 1
        process.stdin.write(json.dumps({"jsonrpc":"2.0","id":sequence,"method":method,"params":params})+"\n");process.stdin.flush()
        reply = json.loads(process.stdout.readline())
        assert "error" not in reply, reply
        return reply["result"]
    rpc("initialize",{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"workflow-python","version":"1"}})
    process.stdin.write(json.dumps({"jsonrpc":"2.0","method":"notifications/initialized"})+"\n");process.stdin.flush()
    assert len(rpc("tools/list",{})["tools"]) == 14
    def mcp(route,args):
        result = rpc("tools/call",{"name":"realflow."+route.replace("/","."),"arguments":args})
        assert result["isError"] is False, result
        return result["structuredContent"]
    flow(mcp)
finally:
    process.communicate(timeout=10);timer.cancel()
    assert process.returncode == 0
print(str(len(local))+" shared security scenarios and all eleven draft tool names over HTTP/MCP passed in both language directions.")


# Actual Node-produced ciphertext/signature is decrypted by the Python service.
source=run(["node","scripts/security-tools-exchange.mjs"]).strip()
r=SecurityFixture().service.invoke("decrypt",{"operation_id":"op-1","sections":[{"id":"node","content":source}]},"test-owner")
assert r["results"][0]["content"]=="NODE SYNTHETIC 🧪",r
print("Node AES/signature output decrypted in Python; Python AES/signature vectors decrypted in Node.")
