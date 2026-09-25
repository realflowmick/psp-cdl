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
from lifecycle_fixtures import SUITE, Fixture, run_case
from psp_cdl_api_server.http import create_wsgi_app
ROOT = Path(__file__).resolve().parents[1]

def run(args):
    p = subprocess.run(args,cwd=ROOT,capture_output=True,text=True,encoding="utf-8",timeout=60)
    assert p.returncode == 0, p.stdout+p.stderr
    return p.stdout

peer = json.loads(run(["node","scripts/lifecycle-probe.mjs","--report"]))
local = [{"id":c["id"],"results":run_case(c)} for c in SUITE["cases"]]
assert peer == local

def flow(call):
    created=call("sessions/create",{"requestId":"wire-create","nodeId":"entry","nodeVersion":"1","expiresAt":1900,"state":{"stage":"created"}})
    sid=created["result"]["sessionId"]
    assert any(s["sessionId"]==sid for s in call("sessions/list",{"after":None,"limit":50,"status":"all"})["result"]["sessions"])
    call("checkpoints/create",{"requestId":"wire-pause","sessionId":sid,"expectedVersion":1,"expiresAt":1500})
    cancel={"requestId":"wire-cancel","sessionId":sid,"expectedVersion":2}
    cancelled=call("sessions/cancel",cancel)
    assert cancelled["result"]["status"]=="cancelled" and call("sessions/cancel",cancel)==cancelled
    version=3
    for i in range(10):
        command={"requestId":"wire-purge-"+str(i),"sessionId":sid,"expectedVersion":version}
        cleaned=call("sessions/purge",command);version=cleaned["result"]["version"]
        assert call("sessions/purge",command)==cleaned
        if not cleaned["result"]["more"]:break
        assert i<9
    assert not any(s["sessionId"]==sid for s in call("sessions/list",{"after":None,"limit":50,"status":"all"})["result"]["sessions"])

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
    print(run(["node","scripts/lifecycle-probe.mjs","--http-client","http://127.0.0.1:"+str(server.server_port)]).strip())
finally:
    server.shutdown();thread.join(timeout=5)

process = subprocess.Popen(["node","scripts/lifecycle-probe.mjs","--http-server"],cwd=ROOT,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,encoding="utf-8")
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

print(run(["node","scripts/lifecycle-probe.mjs","--python-stdio",sys.executable]).strip())
process = subprocess.Popen(["node","scripts/lifecycle-probe.mjs","--stdio"],cwd=ROOT,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,encoding="utf-8")
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
    assert len(rpc("tools/list",{})["tools"]) == 11
    def mcp(route,args):
        result = rpc("tools/call",{"name":"realflow."+route.replace("/","."),"arguments":args})
        assert result["isError"] is False, result
        return result["structuredContent"]
    flow(mcp)
finally:
    process.communicate(timeout=10);timer.cancel()
    assert process.returncode == 0
print(str(len(local))+" shared lifecycle scenarios and real mutations over HTTP/MCP passed in both language directions.")

# Reopen one file across independent processes/languages; old tokens/receipts cannot restore it.
import tempfile
import sqlite3
from contextlib import closing
from concurrent.futures import ThreadPoolExecutor

def store_probe(language,path,command):
    argv=["node","scripts/lifecycle-store-probe.mjs",str(path)] if language=="ts" else [sys.executable,"scripts/lifecycle_store_probe.py",str(path)]
    p=subprocess.run(argv,input=json.dumps(command),cwd=ROOT,capture_output=True,text=True,encoding="utf-8",timeout=20)
    assert p.returncode==0,p.stderr
    return json.loads(p.stdout)

with tempfile.TemporaryDirectory(prefix="psp-lifecycle-parity-") as directory:
    for first,second in (("ts","py"),("py","ts")):
        path=Path(directory)/(first+"-restart.sqlite")
        seeded=store_probe(first,path,{"operation":"seed","waiting":True})["result"];sid=seeded["sessionId"]
        cancelled=store_probe(second,path,{"operation":"cancelSession","command":{"requestId":"cancel","sessionId":sid,"expectedVersion":2}})
        assert cancelled["result"]["status"]=="cancelled"
        version=3
        for i in range(10):
            command={"operation":"purgeSession","command":{"requestId":"purge-"+str(i),"sessionId":sid,"expectedVersion":version}}
            cleaned=store_probe(first,path,command)
            assert store_probe(second,path,command)==cleaned
            version=cleaned["result"]["version"]
            if not cleaned["result"]["more"]:break
            assert i<9
        assert store_probe(second,path,{"operation":"execute","command":{"action":"resumeCheckpoint","requestId":"resume","checkpointId":seeded["checkpoint"]["checkpointId"],"resumeToken":seeded["checkpoint"]["resumeToken"],"state":{}}})=={"error":"NOT_FOUND"}
        with closing(sqlite3.connect(path)) as db:
            assert not any("SYNTHETIC_PAYLOAD" in r[0] for r in db.execute("SELECT body FROM psp_records WHERE kind!='node'"))
    for mode in ("update","resume","duplicate"):
        path=Path(directory)/(mode+"-race.sqlite")
        seeded=store_probe("ts",path,{"operation":"seed","waiting":mode=="resume"})["result"];sid=seeded["sessionId"]
        cancel={"operation":"cancelSession","command":{"requestId":"cancel","sessionId":sid,"expectedVersion":2 if mode=="resume" else 1}}
        if mode=="resume":peer={"operation":"execute","command":{"action":"resumeCheckpoint","requestId":"resume","checkpointId":seeded["checkpoint"]["checkpointId"],"resumeToken":seeded["checkpoint"]["resumeToken"],"state":{}}}
        elif mode=="duplicate":peer=cancel
        else:peer={"operation":"execute","command":{"action":"updateSession","requestId":"update","sessionId":sid,"expectedVersion":1,"nodeId":"entry","nodeVersion":"1","policyVersion":"policy-1","status":"completed","state":{}}}
        with ThreadPoolExecutor(2) as pool:
            a=pool.submit(store_probe,"ts",path,cancel);b=pool.submit(store_probe,"py",path,peer);results=[a.result(),b.result()]
        if mode=="duplicate":assert results[0]==results[1] and "result" in results[0],results
        else:assert sum("result" in r for r in results)==1 and next(r["error"] for r in results if "error" in r)=="STATE_CONFLICT",results
    path=Path(directory)/"rollback.sqlite"
    seeded=store_probe("py",path,{"operation":"seed"})["result"]
    with closing(sqlite3.connect(path)) as db:db.execute("CREATE TRIGGER fail_lifecycle BEFORE INSERT ON psp_records WHEN NEW.kind='receipt' BEGIN SELECT RAISE(ABORT,'synthetic'); END")
    for language in ("ts","py"):
        assert store_probe(language,path,{"operation":"cancelSession","command":{"requestId":"fail","sessionId":seeded["sessionId"],"expectedVersion":1}})=={"error":"STORE_FAILURE"}
        state=store_probe(language,path,{"operation":"read","sessionId":seeded["sessionId"]})["result"]
        assert state["revision"]==1 and state["body"]["status"]=="running"
print("Lifecycle: two-way restart/cleanup, three mixed-language races and transactional rollback passed.")
