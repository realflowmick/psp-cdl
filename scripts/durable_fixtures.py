# SPDX-License-Identifier: Apache-2.0
import json
from pathlib import Path
from copy import deepcopy
from llm_fixtures import Fixture as LlmFixture
from psp_cdl_llmproxy import DurableLlmLoop
from psp_cdl_mcpproxy import binding_digest
from psp_cdl_api_server.persistence import StoreError

SUITE=json.loads((Path(__file__).resolve().parents[1]/"conformance/vectors/llm/durable-0.1.json").read_text(encoding="utf-8"))


class Fixture(LlmFixture):
    def __init__(self, settings=None):
        settings=settings or {}
        super().__init__({**settings,"base":{**settings.get("base",{}),"durableTurns":not settings.get("disabledStore")}})
        self.events,self.commands=[],[]
        self.base.principal["scopes"] += ["sessions:read","sessions:write"]
        self.options.update(requestId="turn-1",expectedVersion=1)
        commit=self.base.backend.commit
        def committing(*args):
            turn=any(w["body"].get("profile")=="PSP-LLM-DURABLE-0.1" for w in args[2])
            if turn and self.flags.get("failBeforeCommit"): raise StoreError("STORE_FAILURE")
            ok=commit(*args)
            if turn and ok:
                if self.flags.get("cancelAfterCommit"): self.base.flags["cancelled"]=True
                if self.flags.get("driftAfterCommit"): self.base.flags["drift"]=True
                if self.flags.get("failAfterCommit"): raise StoreError("STORE_FAILURE")
            return ok
        self.base.backend.commit=committing
        self.base.flags["denyPersistence"]=bool(self.flags.get("denyStorage"))
        try: self.loop=DurableLlmLoop(self.base.store,self.base.gate,self,self.provider,{"postCompletion":settings.get("postCompletion","lockdown")})
        except Exception:
            self.close()
            raise
    def plan_turn(self,p,b,data):
        if self.flags.get("throwPlan"): raise RuntimeError("PRIVATE_PLAN_DETAIL")
        if self.flags.get("badPlan"): return {"state":{},"complete":"yes","retained":{}}
        return {"state":{"answer":data["candidate"]["text"],**({"llmCompletion":{"policy":"lockdown"}} if self.flags.get("forgedState") else {})},"retained":{"covenants":["no-display-to-operator"] if self.flags.get("retainedDisplay") else ["no-training"]},"complete":not self.flags.get("continueTurn")}
    def authenticate(self,token):
        principal=super().authenticate(token)
        if principal:
            principal=deepcopy(principal)
            principal["scopes"]=[s for s in principal["scopes"] if not (s=="sessions:read" and self.flags.get("noReadScope") or s=="sessions:write" and self.flags.get("noWriteScope") or s=="models:invoke" and self.flags.get("noModelScope"))]
        return principal
    def authorize_transition(self,p,c):
        self.commands.append(deepcopy(c["command"]))
        for flag,key,value in (("transitionDrift","drift",True),("transitionCancel","cancelled",True),("transitionRevoke","revoked",True),("transitionExpiry","now",1700)):
            if self.flags.get(flag): self.base.flags[key]=value
        if self.flags.get("transitionRace"):
            try: self.base.update()
            except StoreError as exc:
                if exc.code!="STATE_BUSY": raise
                self.events.append({"signal":"STATE_BUSY"})
        if self.flags.get("mutateTransition"):
            p["subjectId"],c["command"]["state"],c["result"]["output"]["text"]="forged",{"forged":True},"forged"
        if self.flags.get("throwTransition"): raise RuntimeError("PRIVATE_TRANSITION_DETAIL")
        return not self.flags.get("denyTransition")
    def audit(self,p,event):
        self.events.append(event)
        if self.flags.get("throwAudit"): raise RuntimeError("PRIVATE_AUDIT_DETAIL")
        return not self.flags.get("denyAudit")
    def authorize_recovery(self,*_):
        if self.flags.get("recoveryDrift"): self.base.flags["drift"]=True
        if self.flags.get("recoveryRevoke"): self.base.flags["revoked"]=True
        return not self.flags.get("denyRecovery")
    def recovery_policy(self,p,b,r):
        return {"bindingDigest":"wrong" if self.flags.get("wrongRecoveryBinding") else binding_digest(b),"resources":[] if self.flags.get("emptyRecovery") else [{"classes":[],"covenants":["unknown-term"] if self.flags.get("unsupportedRecovery") else r["retained"]["covenants"],"capabilities":["used-for-model-training"] if self.flags.get("denyRecoveryPolicy") else [],"checks":{},"parameters":{},"context":{}}]}
    def policy(self,p,b,d,phase):
        result=super().policy(p,b,d,phase)
        if self.flags.get("denyAfterCommit") and b.get("committedVersion"): result["resources"][0]["capabilities"]=["used-for-model-training"]
        return result


def run_case(case):
    f=None
    steps=[]
    try:
        f=Fixture(case.get("settings"))
        for step in case.get("steps",[{"action":"run"}]):
            f.flags.update(step.get("flags",{})); f.base.flags.update(step.get("baseFlags",{}))
            options={**f.options,**step.get("options",{})}
            token=step.get("token","test-owner")
            try:
                value=f.loop.recover(token,f.base.session["sessionId"],step.get("requestId","turn-1"),options) if step["action"]=="recover" else f.loop.run(token,f.base.session["sessionId"],step.get("request",{"message":"Read synthetic data."}),options)
                steps.append({"code":"OK","value":value})
            except Exception as exc:
                steps.append({"code":getattr(exc,"code","UNEXPECTED_ERROR"),**({"response":exc.response} if hasattr(exc,"response") else {})})
        state=f.base.store.execute(f.base.actor,{"action":"getSession","sessionId":f.base.session["sessionId"]})
        return normalize({"steps":steps,"codes":[s["code"] for s in steps],"released":sum(s["code"]=="OK" for s in steps),**f.stats(),"version":state["version"],"status":state["status"],"completion":state.get("llmCompletion"),"state":state["state"],"events":f.events,"commands":f.commands,"audits":sum(e["signal"]=="post_completion_override_attempt" for e in f.events),"transitions":len(f.commands)},f.base.session["sessionId"])
    except Exception as exc: return {"code":getattr(exc,"code","UNEXPECTED_ERROR")}
    finally:
        if f: f.close()


def normalize(value,session_id): return json.loads(json.dumps(value).replace(session_id,"<session>"))
