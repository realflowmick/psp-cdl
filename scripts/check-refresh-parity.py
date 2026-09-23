# SPDX-License-Identifier: Apache-2.0
import json
import subprocess
import importlib.util
import sys
import tempfile
from pathlib import Path
from refresh_fixtures import SUITE,Fixture,run_case
from psp_cdl_llmproxy import compare_prompt_versions
ROOT=Path(__file__).resolve().parents[1]
source="import {suite,runCase} from './scripts/refresh-fixtures.mjs';import {comparePromptVersions} from '@psp-cdl/llmproxy'; const out=[];for(const c of suite.cases)out.push(await runCase(c));console.log(JSON.stringify({cases:out,versions:suite.versions.map(([a,b])=>comparePromptVersions(a,b))}));"
peer=subprocess.run(["node","--input-type=module","-e",source],cwd=ROOT,check=True,capture_output=True,text=True,encoding="utf-8")
ts=json.loads(peer.stdout)
for case,actual in zip(SUITE["cases"],ts["cases"],strict=True):
    py=run_case(case)
    if actual!=py:raise SystemExit(case["id"]+": refresh parity mismatch\n"+ascii(actual)+"\n"+ascii(py))
    for key,value in case["expected"].items():
        if actual.get(key)!=value:raise SystemExit(case["id"]+": "+key+" expected "+repr(value)+" actual "+ascii(actual))
for (a,b,expected),actual in zip(SUITE["versions"],ts["versions"],strict=True):assert actual==expected==compare_prompt_versions(a,b)
print(f"{len(SUITE['cases'])} refresh cases agree, including metadata, counters, audit events and exact provider transcripts; SemVer precedence agrees.")

spec=importlib.util.spec_from_file_location("persistence_parity",ROOT/"scripts/check-persistence-parity.py")
storage=importlib.util.module_from_spec(spec);spec.loader.exec_module(storage)
def call(lang,path,command=None,**options):return storage.call(lang,path,command,durableTurns=True,promptRefresh=True,**options)
f=Fixture()
try:
    f.loop.run("test-owner",f.base.session["sessionId"],{"message":"hello"},f.options)
    turn_template=f.commands[0]
    state={**f.base.store.execute(f.base.actor,{"action":"getPromptState","sessionId":f.base.session["sessionId"]})["state"],"turnCount":0}
finally:f.close()

peers={"ts":["node","scripts/refresh-probe.mjs"],"py":[sys.executable,"scripts/refresh_probe.py"]}
def loop(lang,path,session,**options):
    request={"actor":storage.ACTOR,"sessionId":session["sessionId"],**options}
    p=subprocess.run([*peers[lang],str(path)],cwd=ROOT,input=json.dumps(request),capture_output=True,text=True,encoding="utf-8",timeout=20)
    assert p.returncode==0,p.stderr
    return json.loads(p.stdout)

with tempfile.TemporaryDirectory(prefix="psp-refresh-") as temp:
    directory=Path(temp)
    for creator,consumer in (("ts","py"),("py","ts")):
        path=directory/(creator+"-restart.sqlite")
        call(creator,path,storage.NODE)
        session=call(creator,path,storage.CREATE)["result"]
        first=loop(creator,path,session,requestId="turn-1",expectedVersion=1,now=100)
        assert first["prompt"]["state"]["turnCount"]==1 and not first["refreshes"]
        second=loop(consumer,path,session,requestId="turn-2",expectedVersion=2,now=101)
        assert second["refreshes"][0]["trigger"]=="interval"
        assert second["prompt"]["state"]["version"]=="1.0.1" and second["prompt"]["state"]["turnCount"]==1
        assert second["requests"][0]["messages"][0]["content"]=="System 1.0.1"
        # Stored metadata can fetch a replacement after the accepted envelope expired.
        third=loop(creator,path,session,requestId="turn-3",expectedVersion=3,now=151,nextVersion="1.0.2")
        assert third["refreshes"][0]["trigger"]=="expiration"
        assert third["prompt"]["state"]["refreshCount"]==2 and third["prompt"]["sessionVersion"]==4
        recovered=loop(consumer,path,session,requestId="turn-3",expectedVersion=3,now=152,recover=True)
        assert recovered["result"]["receipt"]["recovered"] is True
        assert recovered["prompt"]==third["prompt"] and not recovered["requests"] and not recovered["refreshes"]
        call(creator,path,mode="crashUncommitted")
        assert Path(str(path)+"-journal").stat().st_size>512
        assert call(consumer,path,{"action":"getPromptState","sessionId":session["sessionId"]})["result"]==third["prompt"]

    for name in ("initialize","refresh","turns","identical-turn","refresh-versus-turn"):
        local=directory/name;local.mkdir();path=local/"race.sqlite"
        call("ts",path,storage.NODE);session=call("py",path,storage.CREATE)["result"]
        get={"action":"getPromptState","sessionId":session["sessionId"]}
        put={"action":"putPromptState","sessionId":session["sessionId"],"expectedVersion":1,"refreshRevision":0,"state":state}
        turn={**turn_template,"sessionId":session["sessionId"],**{k:session[k] for k in ("nodeId","nodeVersion","policyVersion")}}
        if name=="initialize":commands=[put,put]
        else:
            assert "result" in call("ts",path,put,crashAfterCommit=True)
            put={**put,"refreshRevision":1,"state":{**state,"version":"1.0.1","timestamp":901,"refreshCount":1}}
            commands=[put,put] if name=="refresh" else [turn,turn] if name=="identical-turn" else [put,turn] if name=="refresh-versus-turn" else [turn,{**turn,"requestId":"competitor"}]
        results=storage.race(path,local,commands,durableTurns=True,promptRefresh=True)
        if name=="identical-turn":assert results[0]==results[1] and "result" in results[0],results
        else:
            assert sum("result" in r for r in results)==1 and {"error":"STATE_CONFLICT"} in results,results
        prompt=call("py",path,get)["result"]
        session_after=call("ts",path,{"action":"getSession","sessionId":session["sessionId"]})["result"]
        winner=next(c for c,r in zip(commands,results) if "result" in r)
        committed=winner["action"]=="commitRefreshedTurn"
        assert prompt["state"]["turnCount"]==int(committed)
        assert prompt["sessionVersion"]==session_after["version"]==1+int(committed)
        assert prompt["revision"]==(1 if name=="initialize" else 2)
        if committed:
            assert call("py",path,winner)["result"]==call("ts",path,{"action":"getTurn","sessionId":session["sessionId"],"requestId":winner["requestId"]})["result"]
            assert call("ts",path,get)["result"]==prompt  # Receipt replay never counts twice.
print("Two-way refresh loops survived process restart, expired-prompt retrieval and rollback-journal recovery; five mixed-language metadata/turn races passed.")
