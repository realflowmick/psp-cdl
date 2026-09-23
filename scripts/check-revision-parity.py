# SPDX-License-Identifier: Apache-2.0
"""Shared oracle and real opposite-language peers on both supported transports."""
import json
import os
import queue
import shutil
import subprocess
import sys
import tempfile
import threading
from contextlib import contextmanager, ExitStack
from pathlib import Path
from revision_fixtures import SUITE, run_revision_case
ROOT=Path(__file__).resolve().parents[1]
NODE=shutil.which("node")
def run(args):
    r=subprocess.run(args,cwd=ROOT,capture_output=True,text=True,encoding="utf-8",timeout=30)
    if r.returncode: raise AssertionError(r.stdout+r.stderr)
    return json.loads(r.stdout)
ts=run([NODE,"scripts/revision-fixtures.mjs","--emit"])
py=[run_revision_case(c) for c in SUITE["cases"]]
assert ts==py==[c["expected"] for c in SUITE["cases"]]

@contextmanager
def peer(language,transport,mode,spy,revision="tool-1"):
    cfg={"transport":transport,"mode":mode,"spy":str(spy),"revision":revision}
    command=[NODE,str(ROOT/"scripts/revision-peer.mjs")] if language=="ts" else [sys.executable,str(ROOT/"scripts/revision_peer.py")]
    command.append(json.dumps(cfg))
    base={"serverInfo":{"name":"psp-cdl-reference","version":"0.1.0"},"timeoutMs":3000,"revisionProfile":"PSP-MCP-REVISION-0.1"}
    if transport=="stdio":
        yield {**base,"executable":command[0],"args":command[1:],"env":{k:v for k,v in os.environ.items() if k in ("SystemRoot","SYSTEMROOT","PATH","PYTHONIOENCODING")}}
        return
    p=subprocess.Popen(command,cwd=ROOT,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,encoding="utf-8")
    lines=queue.Queue();threading.Thread(target=lambda:lines.put(p.stdout.readline()),daemon=True).start()
    try:
        endpoint=lines.get(timeout=10).strip()
        if not endpoint.startswith("http://127.0.0.1:"): raise AssertionError("peer startup: "+endpoint)
        yield {**base,"endpoint":endpoint,"allowLoopbackHttp":True}
    finally:
        p.stdin.close()
        try: p.wait(5)
        except subprocess.TimeoutExpired: p.kill();p.wait()
        err=p.stderr.read();p.stdout.close();p.stderr.close()
        assert p.returncode==0,err

count=0
for language in ("ts","py"):
    opposite="py" if language=="ts" else "ts"
    command=[NODE,"scripts/revision-probe.mjs"] if language=="ts" else [sys.executable,"scripts/revision_probe.py"]
    for transport in ("stdio","http"):
        for mode,code,calls in [("ok","OK",1),("race","TOOL_FAILED",0),("drift","TOOL_FAILED",0),("missing-receipt","TOOL_FAILED",1),("forged-receipt","TOOL_FAILED",1),("bad-catalog","INVALID_REVISION_DATA",0),("unsupported","REMOTE_ERROR",0),("unapproved","CATALOG_NOT_APPROVED",0),("refresh","OK",2)]:
            with tempfile.TemporaryDirectory(prefix="psp-revision-") as directory, ExitStack() as stack:
                spy=Path(directory)/"spy.txt"
                config=stack.enter_context(peer(opposite,transport,"ok" if mode in ("unapproved","refresh") else mode,spy))
                c={"transport":transport,"config":config,"unapproved":mode=="unapproved"}
                if mode=="refresh": c["nextConfig"]=stack.enter_context(peer(opposite,transport,"ok",spy,"tool-2"))
                result=run([*command,json.dumps(c)])
                expected={"code":code,"released":int(code=="OK")}
                if code=="OK": expected.update(data={"message":"hello 🧪"},toolRevision="tool-2" if mode=="refresh" else "tool-1",registryRevision="registry-2" if mode=="refresh" else "registry-1")
                assert result==expected,(language,transport,mode,result,expected)
                assert (spy.read_text().count("call") if spy.exists() else 0)==calls,(language,transport,mode,"spy")
                count+=1
        print(f"Revision {language} -> {opposite} {transport} passed",flush=True)
print(f"{len(SUITE['cases'])} shared revision vectors and {count} mixed-language stdio/HTTP checks passed.")
