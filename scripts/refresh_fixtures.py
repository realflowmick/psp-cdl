# SPDX-License-Identifier: Apache-2.0
"""Public synthetic keys, callbacks and data only."""
import json
from copy import deepcopy
from pathlib import Path
from durable_fixtures import Fixture as DurableFixture, normalize
from psp_cdl_core.crypto import sign_envelope
from psp_cdl_llmproxy import RefreshingLlmLoop, prompt_context
SUITE=json.loads((Path(__file__).resolve().parents[1]/"conformance/vectors/llm/refresh-0.1.json").read_text(encoding="utf-8"))

class Fixture(DurableFixture):
    def __init__(self,settings=None):
        settings=settings or {}
        super().__init__({"continueTurn":True,**settings,"base":{**settings.get("base",{}),"promptRefresh":not settings.get("disabledRefresh")}})
        self.refresh_requests,self.refresh_events=[],[]
        self.template={"version":"1.0.0","text":"System one.","timestamp":900,"expires":1200,"attributes":{"refresh-policy":"interval|expiration","refresh-interval":"2","refresh-grace":"100"},**settings.get("initial",{})}
        self.base.flags["onInvoke"]=lambda:self.base.flags.update(now=self.flags["afterToolTime"]) if self.flags.get("afterToolTime") else None
        commit=self.base.backend.commit
        def commit_with_ack(*args):
            ok=commit(*args)
            if ok and self.flags.get("failAfterPromptCommit") and any(w["body"].get("profile")=="PSP-PROMPT-REFRESH-0.1" for w in args[2]):raise RuntimeError("PRIVATE_ACK_DETAIL")
            return ok
        self.base.backend.commit=commit_with_ack
        try:self.loop=RefreshingLlmLoop(self.base.store,self.base.gate,self,self.provider,{"postCompletion":"lockdown"})
        except Exception:
            self.close()
            raise
    def sign(self,b,t):return sign_envelope(t["text"],{"algorithm":"hmac-sha256","signatureVersion":"2.0","secretId":"test-signing-key","timestamp":t["timestamp"],"expires":t["expires"],"version":t["version"],"sectionType":"system","contentType":"text","trustLevel":t.get("trustLevel",2),"attributes":{**prompt_context(b),**t["attributes"]}},self.key)
    def prompt(self,p,b):return self.sign(b,{**self.template,**self.flags.get("bindingTemplate",{})})
    def refresh(self,p,b,request):
        self.refresh_requests.append(deepcopy(request))
        if self.flags.get("onRefresh"):self.flags["onRefresh"](p,b,request)
        if self.flags.get("throwRefresh"):raise RuntimeError("PRIVATE_REFRESH_DETAIL")
        for flag,key in (("refreshCancel","cancelled"),("refreshDrift","drift"),("refreshRevoke","revoked")):
            if self.flags.get(flag):self.base.flags[key]=True
        if self.flags.get("refreshRace"):
            try:self.base.update()
            except Exception as exc:
                if getattr(exc,"code",None)!="STATE_BUSY":raise
                self.refresh_events.append({"signal":"STATE_BUSY"})
        self.template={**self.template,"version":self.flags.get("refreshVersion","1.0.1"),"text":self.flags.get("refreshText","System refreshed."),"timestamp":self.flags.get("refreshTimestamp",self.base.flags["now"]),"expires":self.flags.get("refreshExpires",self.base.flags["now"]+500),**self.flags.get("replacement",{})}
        e=self.sign(b,self.template)
        if self.flags.get("tamperedRefresh"):e["data"]="tampered"
        if self.flags.get("wrongRefreshScope"):e["signature"]["attributes"]["session-id"]="other"
        return e
    def authorize_refresh(self,p,b,previous,candidate):return not self.flags.get("denyInitial" if b["trigger"]=="initial" else "denyRefresh")
    def audit_refresh(self,p,event):
        self.refresh_events.append(event)
        if self.flags.get("throwRefreshAudit"):raise RuntimeError("PRIVATE_AUDIT_DETAIL")
        return not self.flags.get("denyRefreshAudit")
    def invoke(self,*args):
        result=super().invoke(*args)
        if self.flags.get("afterProviderTime"):self.base.flags["now"]=self.flags["afterProviderTime"]
        return result

def run_case(case):
    f=None;steps=[]
    try:
        f=Fixture(case.get("settings"))
        for step in case.get("steps",[{"action":"run"}]):
            f.flags.update(step.get("flags",{}));f.base.flags.update(step.get("baseFlags",{}))
            options={**f.options,**step.get("options",{})}
            if step["action"]=="restart":f.loop=RefreshingLlmLoop(f.base.store,f.base.gate,f,f.provider,{"postCompletion":"lockdown"})
            try:
                value=f.loop.recover(step.get("token","test-owner"),f.base.session["sessionId"],step.get("requestId","turn-1"),options) if step["action"]=="recover" else f.loop.run(step.get("token","test-owner"),f.base.session["sessionId"],step.get("request",{"message":"Read synthetic data."}),options)
                steps.append({"code":"OK","value":value})
            except Exception as exc:steps.append({"code":getattr(exc,"code","UNEXPECTED_ERROR")})
        state=f.base.store.execute(f.base.actor,{"action":"getSession","sessionId":f.base.session["sessionId"]})
        prompt=None
        try:prompt=f.base.store.execute(f.base.actor,{"action":"getPromptState","sessionId":f.base.session["sessionId"]})
        except Exception as exc:
            if getattr(exc,"code",None)!="NOT_FOUND":raise
        return normalize({"steps":steps,"codes":[s["code"] for s in steps],"released":sum(s["code"]=="OK" for s in steps),**f.stats(),"sessionVersion":state["version"],"status":state["status"],"prompt":prompt,"turnCount":prompt["state"]["turnCount"] if prompt else None,"refreshCount":prompt["state"]["refreshCount"] if prompt else None,"version":prompt["state"]["version"] if prompt else None,"refreshCalls":len(f.refresh_requests),"refreshRequests":f.refresh_requests,"events":f.refresh_events,"requests":f.requests,"commands":f.commands},f.base.session["sessionId"])
    except Exception as exc:return {"code":getattr(exc,"code","UNEXPECTED_ERROR")}
    finally:
        if f:f.close()
