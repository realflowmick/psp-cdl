# SPDX-License-Identifier: Apache-2.0
import json
import sqlite3
from pathlib import Path
from copy import deepcopy
from durable_fixtures import Fixture as DurableFixture
from psp_cdl_llmproxy import ScopedLlmLoop,scoped_prompt_context
from psp_cdl_core.crypto import sign_envelope
from psp_cdl_mcpproxy import binding_digest

SUITE=json.loads((Path(__file__).resolve().parents[1]/"conformance/vectors/llm/scoped-0.1.json").read_text(encoding="utf-8"))
SYSTEM="Discuss only the completed synthetic results."
class Fixture(DurableFixture):
    def __init__(self,settings=None):
        self.settings=settings or {};super().__init__({"base":{"scopedTurns":not self.settings.get("disabledScoped")}})
        self.boundaries,self.prompt_bindings=[],[]
        self.definition={"postCompletion":"scoped","scope":{"id":"results","version":"1","system":"" if self.settings.get("emptySystem") else SYSTEM,"threatPolicy":{"id":"restricted-threat","version":"2"} if self.settings.get("explicitPolicy") else None}}
        invoke=self.provider["invoke"]
        def scoped_invoke(r,o):
            result=invoke(r,o)
            if r["tools"]:return result
            if self.flags.get("scopedTool"):return {"type":"tool","name":"echo.read","arguments":{"message":"forbidden"}}
            if self.flags.get("scopedStream"):return iter(["PRIVATE_STREAM"])
            return {"type":"final","text":"Scoped answer 🧪"}
        self.provider={**self.provider,"invoke":scoped_invoke}
        try:
            self.loop=ScopedLlmLoop(self.base.store,self.base.gate,self,self.provider,self.definition)
            self.loop.run("test-owner",self.base.session["sessionId"],{"message":"Finish workflow."},self.options)
            self.options.update(requestId="scope-1",expectedVersion=2)
        except Exception:self.close();raise
    def application_threat(self,*_):return {} if self.settings.get("badApplicationThreat") else {"policy":{"id":"application-threat","version":"1"},"state":{"score":7,"marker":"HOST_THREAT_ONLY"}}
    def scoped_prompt(self,p,b):
        self.prompt_bindings.append(deepcopy(b))
        if self.flags.get("throwScopedPrompt"):raise RuntimeError("PRIVATE_PROMPT_DETAIL")
        if self.flags.get("workflowPrompt"):return self.prompt(p,b)
        attributes=scoped_prompt_context(b)
        if self.flags.get("wrongScopedBinding"):attributes["scope-version"]="99"
        prompt=sign_envelope("Wrong scope." if self.flags.get("wrongScopedText") else SYSTEM,{"algorithm":"hmac-sha256","signatureVersion":"2.0","secretId":"test-signing-key","timestamp":900,"expires":1000 if self.flags.get("expiredScoped") else 1700,"version":"1.0.0","sectionType":"system","contentType":"text","trustLevel":2,"attributes":attributes},bytes([19])*32)
        if self.flags.get("tamperedScoped"):prompt["data"]="tampered"
        return prompt
    def scope_boundary(self,p,b,d):
        self.boundaries.append({"binding":deepcopy(b),"data":deepcopy(d)})
        if self.flags.get("throwBoundary"):raise RuntimeError("PRIVATE_BOUNDARY_DETAIL")
        if self.flags.get("badBoundary"):return {"decision":True}
        for flag,key,value in (("boundaryCancel","cancelled",True),("boundaryRevoke","revoked",True),("boundaryDrift","drift",True),("boundaryExpiry","now",1700)):
            if self.flags.get(flag):self.base.flags[key]=value
        denied=self.flags.get("denyIngress") if b["phase"]=="ingress" else self.flags.get("denyEgress")
        digest=binding_digest(b);state={**d["threatState"],"score":d["threatState"]["score"]+(10 if denied else 1)}
        if self.flags.get("mutateBoundary"):p["subjectId"],b["scope"]["id"],d["threatState"]["marker"],d["request"]["message"]="forged","forged","forged","forged"
        return {"bindingDigest":"wrong" if self.flags.get("wrongBoundaryBinding") else digest,"decision":"unsupported" if self.flags.get("unknownBoundary") else "deny" if denied else "allow","threatState":state}
    def plan_scoped_turn(self,p,b,d):
        if self.flags.get("throwScopedPlan"):raise RuntimeError("PRIVATE_PLAN_DETAIL")
        if self.flags.get("badScopedPlan"):return {"retained":{},"state":{"reopened":True}}
        retained={**d["retained"],"scoped":True}
        if self.flags.get("mutateScopedPlan"):p["subjectId"],b["scope"]["id"],d["candidate"]["text"]="forged","forged","forged"
        return {"retained":retained}
    def policy(self,p,b,d,phase):
        result=super().policy(p,b,d,phase)
        if b.get("postCompletion")=="scoped" and (self.flags.get("denyInference") and phase=="inference" or self.flags.get("denyRelease") and phase=="release"):result["resources"][0]["capabilities"]=["used-for-model-training"]
        return result
    def replace_scope(self):return ScopedLlmLoop(self.base.store,self.base.gate,self,self.provider,{**self.definition,"scope":{**self.definition["scope"],"version":"2"}})
    def records(self):
        db=sqlite3.connect(str(Path(self.base.directory.name)/"state.sqlite"))
        try:return [json.loads(r[0]) for r in db.execute("SELECT body FROM psp_records ORDER BY kind,record_key")]
        finally:db.close()

def run_case(case):
    f=None;steps=[]
    try:
        f=Fixture(case.get("settings"));f.flags.update(case.get("flags",{}))
        if f.flags.get("changedScope"):f.loop=f.replace_scope()
        for step in case.get("steps",[{}]):
            f.flags.update(step.get("flags",{}));f.base.flags.update(step.get("baseFlags",{}));f.base.flags["denyPersistence"]=bool(f.flags.get("denyStorage"))
            options={**f.options,**step.get("options",{})};token=step.get("token","test-owner")
            try:
                value=f.loop.recover(token,f.base.session["sessionId"],step.get("requestId","scope-1"),options) if step.get("action")=="recover" else f.loop.run(token,f.base.session["sessionId"],step.get("request",{"message":"Explain the completed result."}),options)
                steps.append({"code":"OK","value":value})
            except Exception as exc:steps.append({"code":getattr(exc,"code","UNEXPECTED_ERROR")})
        all_records=f.records();state=next(r for r in all_records if r.get("sessionId")==f.base.session["sessionId"] and r.get("status"));meta=state["llmCompletion"]
        receipts=sorted((r["result"] for r in all_records if r.get("result",{}).get("scoped")),key=lambda r:r["requestId"])
        return json.loads(json.dumps({"steps":steps,"codes":[s["code"] for s in steps],"version":state["version"],**f.stats(),"turnCount":meta["turnCount"],"violationCount":meta["violationCount"],"state":state,"receipts":receipts,"boundaries":f.boundaries,"promptBindings":f.prompt_bindings,"requests":f.requests,"commands":f.commands}).replace(f.base.session["sessionId"],"<session>"))
    except Exception as exc:return {"code":getattr(exc,"code","UNEXPECTED_ERROR")}
    finally:
        if f:f.close()
