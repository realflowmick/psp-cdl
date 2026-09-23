# SPDX-License-Identifier: Apache-2.0
import json
import os
import queue
import shutil
import subprocess
import sys
import tempfile
import threading
from contextlib import contextmanager
from pathlib import Path
from mcp_refresh_fixtures import SUITE,run_case
ROOT=Path(__file__).resolve().parents[1]
NODE=shutil.which("node")
def run(command):
    p=subprocess.run(command,cwd=ROOT,capture_output=True,text=True,encoding="utf-8",timeout=30)
    assert p.returncode==0,p.stderr
    return json.loads(p.stdout)
actuals=run([NODE,"--input-type=module","-e","import {suite,runCase} from './scripts/mcp-refresh-fixtures.mjs';console.log(JSON.stringify(await Promise.all(suite.cases.map(runCase))));"])
for case,ts in zip(SUITE["cases"],actuals,strict=True):
    py=run_case(case)
    assert ts==py,(case["id"],ts,py)
    for key,value in case["expected"].items():assert ts[key]==value,(case["id"],ts)
print(f"{len(actuals)} MCP refresh cases agree on calls, withheld results and exact wire arguments.",flush=True)

@contextmanager
def peer(language,transport,mode,spy):
    command=[NODE,"scripts/mcp-refresh-peer.mjs"] if language=="ts" else [sys.executable,"scripts/mcp_refresh_peer.py"]
    command.append(json.dumps({"transport":transport,"mode":mode,"spy":str(spy)}))
    base={"serverInfo":{"name":"psp-cdl-reference","version":"0.1.0"},"timeoutMs":3000}
    if transport=="stdio":
        yield {**base,"executable":command[0],"args":command[1:],"env":{**{k:v for k,v in os.environ.items() if k.upper() in ("SYSTEMROOT","WINDIR","PATH")},"PSP_REFRESH_TOKEN":"synthetic-refresh-token"}}
        return
    p=subprocess.Popen(command,cwd=ROOT,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,encoding="utf-8")
    lines=queue.Queue();threading.Thread(target=lambda:lines.put(p.stdout.readline()),daemon=True).start()
    try:
        endpoint=lines.get(timeout=10).strip();assert endpoint.startswith("http://127.0.0.1:"),endpoint
        yield {**base,"endpoint":endpoint,"allowLoopbackHttp":True}
    finally:
        p.stdin.close()
        try:p.wait(5)
        except subprocess.TimeoutExpired:p.kill();p.wait()
        err=p.stderr.read();p.stdout.close();p.stderr.close();assert p.returncode==0,err
count=0
for language,other in (("ts","py"),("py","ts")):
    command=[NODE,"scripts/mcp-refresh-probe.mjs"] if language=="ts" else [sys.executable,"scripts/mcp_refresh_probe.py"]
    for transport in ("stdio","http"):
        for mode,code,calls in (("normal","OK",1),("missing","DISCOVERY_MISMATCH",0),("schema","DISCOVERY_MISMATCH",0),("drift-before","DISCOVERY_CHANGED",0),("drift-after","DISCOVERY_CHANGED",1),("malformed","INVALID_REFRESH_RESPONSE",1),("unapproved","CATALOG_NOT_APPROVED",0),("unauthenticated","PEER_UNAUTHENTICATED" if transport=="http" else "REMOTE_ERROR",0)):
            with tempfile.TemporaryDirectory(prefix="psp-mcp-refresh-") as tmp:
                spy=Path(tmp)/"spy.txt"
                with peer(other,transport,"normal" if mode in ("unapproved","unauthenticated") else mode,spy) as config:
                    if mode=="unauthenticated" and transport=="stdio":config["env"]["PSP_REFRESH_TOKEN"]="wrong"
                    actual=run([*command,json.dumps({"transport":transport,"config":config,"unapproved":mode=="unapproved","badToken":mode=="unauthenticated"})])
                    expected={"code":code,"released":int(code=="OK"),**({"data":"Fresh system 🧪"} if code=="OK" else {})}
                    assert actual==expected,(language,transport,mode,actual,expected)
                assert (spy.read_text().count("call") if spy.exists() else 0)==calls,(language,transport,mode,"spy")
                count+=1
        print(f"MCP refresh {language} -> {other} {transport} passed",flush=True)
print(f"{count} mixed-language MCP prompt refresh calls passed; no live provider or credentials used.")
