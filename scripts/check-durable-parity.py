# SPDX-License-Identifier: Apache-2.0
"""Compare committed state, outputs, write commands and lockdown audit events."""
import json
import subprocess
import importlib.util
import sys
import tempfile
from pathlib import Path
from durable_fixtures import SUITE, run_case

ROOT=Path(__file__).resolve().parents[1]
source="import {suite,runCase} from './scripts/durable-fixtures.mjs'; const out=[]; for(const c of suite.cases)out.push(await runCase(c)); console.log(JSON.stringify(out));"
peer=subprocess.run(["node","--input-type=module","-e",source],cwd=ROOT,check=True,capture_output=True,text=True,encoding="utf-8")
for case,actual in zip(SUITE["cases"],json.loads(peer.stdout),strict=True):
    py=run_case(case)
    if py!=actual: raise SystemExit(case["id"]+": durable parity mismatch\n"+ascii(py)+"\n"+ascii(actual))
    for key,expected in case["expected"].items():
        if actual.get(key)!=expected: raise SystemExit(case["id"]+": "+key+" expected "+repr(expected)+" actual "+ascii(actual))
print(f"{len(SUITE['cases'])} durable cases agree: receipts, state, audit events, release decisions and exact transition commands.")

# Exercise the real persistence peers, with a new process/connection for every operation.
spec=importlib.util.spec_from_file_location("persistence_parity",ROOT/"scripts/check-persistence-parity.py")
storage=importlib.util.module_from_spec(spec)
spec.loader.exec_module(storage)
def call(lang,path,command=None,**options): return storage.call(lang,path,command,durableTurns=True,**options)
from durable_fixtures import Fixture
f=Fixture()
try:
    f.loop.run("test-owner",f.base.session["sessionId"],{"message":"hello"},f.options)
    template=f.commands[0]
finally: f.close()
peers={"ts":["node","scripts/durable-probe.mjs"],"py":[sys.executable,"scripts/durable_probe.py"]}
with tempfile.TemporaryDirectory(prefix="psp-durable-") as temp:
    directory=Path(temp)
    for creator,consumer in (("ts","py"),("py","ts")):
        path=directory/(creator+".sqlite")
        call(creator,path,storage.NODE)
        session=call(creator,path,storage.CREATE)["result"]
        command={**template,"sessionId":session["sessionId"],**{k:session[k] for k in ("nodeId","nodeVersion","policyVersion")}}
        receipt=call(creator,path,command,crashAfterCommit=True)["result"]
        assert call(consumer,path,{"action":"getTurn","sessionId":session["sessionId"],"requestId":"turn-1"})["result"]==receipt
        assert call(consumer,path,command)["result"]==receipt
        get={"action":"getSession","sessionId":session["sessionId"]}
        state=call(consumer,path,get)["result"]
        assert state["version"]==2 and state["status"]=="completed" and state["state"]==command["state"]
        assert state["llmCompletion"]["policy"]=="lockdown"
        # Abrupt exit with a dirty transaction must not corrupt the committed pair.
        call(creator,path,mode="crashUncommitted")
        assert Path(str(path)+"-journal").stat().st_size>512
        assert call(consumer,path,get)["result"]==state
        recovered=[]
        for language in (consumer,creator):
            process=subprocess.run([*peers[language],str(path)],cwd=ROOT,input=json.dumps({"actor":storage.ACTOR,"sessionId":session["sessionId"],"requestId":"turn-1"}),capture_output=True,text=True,encoding="utf-8",check=True,timeout=20)
            result=json.loads(process.stdout)
            assert result["recovered"]["text"]==receipt["output"]["text"] and result["recovered"]["receipt"]["recovered"] is True
            assert result["denied"]["code"]=="PSP_POST_COMPLETION_LOCKDOWN" and len(result["events"])==1
            recovered.append(result)
        assert recovered[0]==recovered[1]
        assert call(creator,path,get)["result"]==state
    for name in ("competing-turns","identical-turn"):
        local=directory/name
        local.mkdir()
        path=local/"race.sqlite"
        call("ts",path,storage.NODE)
        session=call("py",path,storage.CREATE)["result"]
        command={**template,"sessionId":session["sessionId"],**{k:session[k] for k in ("nodeId","nodeVersion","policyVersion")}}
        other=command if name=="identical-turn" else {**command,"requestId":"competitor"}
        results=storage.race(path,local,[command,other],durableTurns=True)
        if name=="identical-turn": assert results[0]==results[1] and "result" in results[0],results
        else:
            assert sum("result" in r for r in results)==1,results
            assert {"error":"STATE_CONFLICT"} in results,results
        state=call("py",path,{"action":"getSession","sessionId":session["sessionId"]})["result"]
        assert state["version"]==2 and state["status"]=="completed"
        for candidate,result in zip((command,other),results,strict=True):
            saved=call("ts",path,{"action":"getTurn","sessionId":session["sessionId"],"requestId":candidate["requestId"]})
            assert saved==result if "result" in result else saved=={"error":"NOT_FOUND"}
print("Durable receipts survived two-way process restart and rollback-journal recovery; both mixed-language commit races and fresh authorized recovery/lockdown passed.")
