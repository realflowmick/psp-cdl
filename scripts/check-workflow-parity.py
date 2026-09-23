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
from workflow_fixtures import SUITE, Fixture, run_case
from psp_cdl_api_server.http import create_wsgi_app
ROOT = Path(__file__).resolve().parents[1]

def run(args):
    p = subprocess.run(args,cwd=ROOT,capture_output=True,text=True,encoding="utf-8",timeout=60)
    assert p.returncode == 0, p.stdout+p.stderr
    return p.stdout

peer = json.loads(run(["node","scripts/workflow-probe.mjs","--report"]))
local = [{"id":c["id"],"results":run_case(c)} for c in SUITE["cases"]]
assert peer == local
assert [r["results"] for r in local] == [c["expected"] for c in SUITE["cases"]]

def flow(call):
    created = call("sessions/create",{"requestId":"wire-create","nodeId":"entry","nodeVersion":"1","expiresAt":1900,"state":{"stage":"created"}})
    assert created["result"]["version"] == 1
    session_id = created["result"]["sessionId"]
    saved = call("sessions/update",{"requestId":"wire-save","sessionId":session_id,"expectedVersion":1,"nodeId":"next","nodeVersion":"1","status":"running","state":{"stage":"saved"}})
    assert saved["result"]["version"] == 2
    checkpoint = call("checkpoints/create",{"requestId":"wire-pause","sessionId":session_id,"expectedVersion":2,"expiresAt":1500})
    assert checkpoint["result"]["sessionVersion"] == 3 and "resumeToken" not in json.dumps(checkpoint)
    resume = {"requestId":"wire-resume","checkpointId":checkpoint["result"]["checkpointId"],"state":{"stage":"resumed"}}
    result = call("checkpoints/resume",resume)
    assert result["result"]["version"] == 4
    assert call("checkpoints/resume",resume) == result
    assert call("sessions/get",{"sessionId":session_id})["result"]["view"]["stage"] == "resumed"

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
    print(run(["node","scripts/workflow-probe.mjs","--http-client","http://127.0.0.1:"+str(server.server_port)]).strip())
finally:
    server.shutdown();thread.join(timeout=5)

process = subprocess.Popen(["node","scripts/workflow-probe.mjs","--http-server"],cwd=ROOT,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,encoding="utf-8")
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

print(run(["node","scripts/workflow-probe.mjs","--python-stdio",sys.executable]).strip())
process = subprocess.Popen(["node","scripts/workflow-probe.mjs","--stdio"],cwd=ROOT,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,encoding="utf-8")
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
    assert len(rpc("tools/list",{})["tools"]) == 8
    def mcp(route,args):
        result = rpc("tools/call",{"name":"realflow."+route.replace("/","."),"arguments":args})
        assert result["isError"] is False, result
        return result["structuredContent"]
    flow(mcp)
finally:
    process.communicate(timeout=10);timer.cancel()
    assert process.returncode == 0
print(str(len(local))+" shared workflow scenarios and real mutations over HTTP/MCP passed in both language directions.")
node_example=json.loads(run(["node","examples/workflow/workflow.mjs"]))
python_example=json.loads(run([sys.executable,"examples/workflow/workflow.py"]))
assert node_example==python_example=={"created":1,"saved":2,"paused":3,"denied":"AUTHORIZATION_DENIED","resumed":4,"view":{"stage":"resumed"}}
print("Both standalone workflow examples passed with identical output.")
