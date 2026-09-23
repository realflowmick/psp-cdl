# SPDX-License-Identifier: Apache-2.0
"""Compare real redirect loops and mixed-language atomic handoff recovery/races."""
import importlib.util
import json
import sqlite3
import subprocess
import sys
import tempfile
from pathlib import Path
from redirect_fixtures import SUITE,Fixture,run_case

ROOT=Path(__file__).resolve().parents[1]
source="import {suite,runCase} from './scripts/redirect-fixtures.mjs'; const out=[]; for(const c of suite.cases)out.push(await runCase(c)); console.log(JSON.stringify(out));"
peer=subprocess.run(["node","--input-type=module","-e",source],cwd=ROOT,check=True,capture_output=True,text=True,encoding="utf-8")
for case,actual in zip(SUITE["cases"],json.loads(peer.stdout),strict=True):
    py=run_case(case)
    if py!=actual: raise SystemExit(case["id"]+": redirect parity mismatch\n"+ascii(py)+"\n"+ascii(actual))
    for key,expected in case["expected"].items():
        if actual.get(key)!=expected: raise SystemExit(case["id"]+": "+key+" expected "+repr(expected)+" actual "+ascii(actual))
print(f"{len(SUITE['cases'])} redirect cases agree: target creation, state, policy bindings, provider calls and withheld output.",flush=True)

spec=importlib.util.spec_from_file_location("persistence_parity",ROOT/"scripts/check-persistence-parity.py")
storage=importlib.util.module_from_spec(spec);spec.loader.exec_module(storage)
def call(lang,path,command=None,**options): return storage.call(lang,path,command,durableTurns=True,redirectTurns=True,**options)
def sessions(path):
    db=sqlite3.connect(path)
    try: return [json.loads(row[0]) for row in db.execute("SELECT body FROM psp_records WHERE kind='session'")]
    finally: db.close()
f=Fixture()
try:
    f.loop.run("test-owner",f.base.session["sessionId"],{"message":"hello"},f.options)
    template=f.commands[0]
finally: f.close()
node={"action":"putNode","nodeId":"support","nodeVersion":"1","definition":{"type":"application"}}
def seed(lang,path):
    call(lang,path,storage.NODE);call(lang,path,node)
    session=call(lang,path,storage.CREATE)["result"]
    command={**template,"sessionId":session["sessionId"],**{k:session[k] for k in ("nodeId","nodeVersion","policyVersion")},"redirect":{**template["redirect"],"expiresAt":180}}
    return session,command
peers={"ts":["node","scripts/durable-probe.mjs"],"py":[sys.executable,"scripts/durable_probe.py"]}
with tempfile.TemporaryDirectory(prefix="psp-redirect-") as temp:
    directory=Path(temp)
    for creator,consumer in (("ts","py"),("py","ts")):
        path=directory/(creator+".sqlite");session,command=seed(creator,path)
        receipt=call(creator,path,command,crashAfterCommit=True)["result"]
        target=call(consumer,path,{"action":"getSession","sessionId":receipt["redirect"]["sessionId"]})["result"]
        assert target["state"]=={"input":command["output"],"retained":command["retained"]}
        assert target["version"]==1 and target["status"]=="running" and len(sessions(path))==2
        assert call(consumer,path,command)["result"]==receipt
        saved=sessions(path);call(creator,path,mode="crashUncommitted")
        assert Path(str(path)+"-journal").stat().st_size>512
        assert call(consumer,path,{"action":"getSession","sessionId":target["sessionId"]})["result"]==target
        assert sessions(path)==saved
        recovered=[]
        for language in (consumer,creator):
            process=subprocess.run([*peers[language],str(path)],cwd=ROOT,input=json.dumps({"actor":storage.ACTOR,"sessionId":session["sessionId"],"requestId":"turn-1","redirect":True}),capture_output=True,text=True,encoding="utf-8",check=True,timeout=20)
            result=json.loads(process.stdout)
            assert result["recovered"]["redirect"]==receipt["redirect"] and result["recovered"]["receipt"]["recovered"] is True
            assert result["denied"]["code"]=="INACTIVE_SESSION" and result["events"]==[]
            recovered.append(result)
        assert recovered[0]==recovered[1] and sessions(path)==saved
    for name in ("competing-turns","identical-turn"):
        local=directory/name;local.mkdir();path=local/"race.sqlite";session,command=seed("ts",path)
        other=command if name=="identical-turn" else {**command,"requestId":"competitor"}
        results=storage.race(path,local,[command,other],durableTurns=True,redirectTurns=True)
        if name=="identical-turn": assert results[0]==results[1] and "result" in results[0],results
        else: assert sum("result" in r for r in results)==1 and {"error":"STATE_CONFLICT"} in results,results
        rows=sessions(path);assert len(rows)==2
        assert sorted((s["version"],s["status"]) for s in rows)==[(1,"running"),(2,"completed")]
print("Two-way redirect restart/hot-journal recovery and two mixed-language commit races preserved exactly one target; authorized recovery never invoked inference.",flush=True)
