# SPDX-License-Identifier: Apache-2.0
"""Shared observable behavior, mixed-language restart continuation and commit races."""
import importlib.util
import json
import subprocess
import sys
import tempfile
from pathlib import Path
from scoped_fixtures import SUITE,Fixture,run_case,SYSTEM

ROOT=Path(__file__).resolve().parents[1]
source="import {suite,runCase} from './scripts/scoped-fixtures.mjs'; const out=[]; for(const c of suite.cases)out.push(await runCase(c)); console.log(JSON.stringify(out));"
peer=subprocess.run(["node","--input-type=module","-e",source],cwd=ROOT,check=True,capture_output=True,text=True,encoding="utf-8")
for case,actual in zip(SUITE["cases"],json.loads(peer.stdout),strict=True):
    py=run_case(case)
    if py!=actual:raise SystemExit(case["id"]+": scoped parity mismatch\n"+ascii(py)+"\n"+ascii(actual))
    for k,expected in case["expected"].items():
        if actual.get(k)!=expected:raise SystemExit(case["id"]+": "+k+" expected "+repr(expected)+" got "+ascii(actual))
print(f"{len(SUITE['cases'])} scoped cases agree: prompt replacement, hard signals, frozen workflow, threat/evidence state and withheld output.",flush=True)
spec=importlib.util.spec_from_file_location("persistence_parity",ROOT/"scripts/check-persistence-parity.py")
storage=importlib.util.module_from_spec(spec);spec.loader.exec_module(storage)
def call(lang,path,command=None,**options):return storage.call(lang,path,command,durableTurns=True,scopedTurns=True,**options)
f=Fixture()
try:
    workflow=f.commands[0]
    f.loop.run("test-owner",f.base.session["sessionId"],{"message":"Explain."},f.options);answer=f.commands[-1]
    f.flags["denyIngress"]=True
    try:f.loop.run("test-owner",f.base.session["sessionId"],{"message":"Outside scope."},{**f.options,"requestId":"violation","expectedVersion":3})
    except Exception as exc:assert exc.code=="PSP_POST_COMPLETION_VIOLATION"
    denial=f.commands[-1]
finally:f.close()
def seed(lang,path):
    call(lang,path,storage.NODE);s=call(lang,path,storage.CREATE)["result"]
    c={**workflow,"sessionId":s["sessionId"],**{k:s[k] for k in ("nodeId","nodeVersion","policyVersion")}}
    call(lang,path,c,crashAfterCommit=True)
    return s
peers={"ts":["node","scripts/scoped-probe.mjs"],"py":[sys.executable,"scripts/scoped_probe.py"]}
def probe(lang,path,session,**options):
    p=subprocess.run([*peers[lang],str(path)],cwd=ROOT,input=json.dumps({"actor":storage.ACTOR,"sessionId":session["sessionId"],**options}),capture_output=True,text=True,encoding="utf-8",check=True,timeout=20)
    return json.loads(p.stdout)
with tempfile.TemporaryDirectory(prefix="psp-scoped-") as temp:
    directory=Path(temp)
    for creator,consumer in (("ts","py"),("py","ts")):
        path=directory/(creator+".sqlite");session=seed(creator,path)
        accepted=probe(consumer,path,session,requestId="answer",expectedVersion=2)
        assert accepted["result"]["code"]=="OK",accepted
        assert accepted["calls"]==[{"messages":[{"role":"system","content":SYSTEM},{"role":"assistant","content":"Finished 🧪"},{"role":"user","content":"Explain."}],"tools":[]}]
        assert accepted["boundaries"]==["ingress","egress"] and accepted["state"]["llmCompletion"]["threatState"]["score"]==9
        recovered=probe(creator,path,session,mode="recover",requestId="answer")
        assert recovered["calls"]==[] and recovered["boundaries"]==[] and recovered["state"]==accepted["state"] and recovered["result"]["value"]["receipt"]["recovered"] is True
        denied=probe(creator,path,session,requestId="denied",expectedVersion=3,message="Outside scope.")
        assert denied["result"]["code"]=="PSP_POST_COMPLETION_VIOLATION" and denied["calls"]==[] and denied["state"]["llmCompletion"]["threatState"]["score"]==19
        recovered=probe(consumer,path,session,mode="recover",requestId="denied")
        assert recovered["result"]["code"]=="PSP_POST_COMPLETION_VIOLATION" and recovered["calls"]==[] and recovered["state"]==denied["state"]
        assert probe(consumer,path,session,mode="recover",requestId="answer",denyRecovery=True)["result"]["code"]=="RECOVERY_DENIED"
        call(creator,path,mode="crashUncommitted")
        assert Path(str(path)+"-journal").stat().st_size>512
        assert call(consumer,path,{"action":"getSession","sessionId":session["sessionId"]})["result"]==denied["state"]
    for name in ("competing-answers","identical-answer","answer-versus-violation"):
        local=directory/name;local.mkdir();path=local/"race.sqlite";session=seed("ts",path)
        c={**answer,"sessionId":session["sessionId"],**{k:session[k] for k in ("nodeId","nodeVersion","policyVersion")}}
        other=c if name=="identical-answer" else {**c,"requestId":"competitor"}
        if name=="answer-versus-violation":other={**other,"output":None,"violationPhase":"ingress","threatState":{"score":17,"marker":"HOST_THREAT_ONLY"},"retained":workflow["retained"]}
        results=storage.race(path,local,[c,other],durableTurns=True,scopedTurns=True)
        if name=="identical-answer":assert results[0]==results[1] and "result" in results[0],results
        else:assert sum("result" in r for r in results)==1 and {"error":"STATE_CONFLICT"} in results,results
        s=call("py",path,{"action":"getSession","sessionId":session["sessionId"]})["result"]
        assert s["version"]==3 and s["status"]=="completed" and s["state"]==workflow["state"] and s["llmCompletion"]["turnCount"]==1
        for candidate,result in zip((c,other),results,strict=True):
            saved=call("ts",path,{"action":"getTurn","sessionId":session["sessionId"],"requestId":candidate["requestId"]})
            assert saved==result if "result" in result else saved=={"error":"NOT_FOUND"}
print("Two-way fresh-process scoped inference, answer/violation recovery and hot-journal recovery passed; three mixed-language races committed one exchange with frozen workflow state.",flush=True)
