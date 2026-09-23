# SPDX-License-Identifier: Apache-2.0
import json
import sqlite3
from pathlib import Path
from copy import deepcopy
from durable_fixtures import Fixture as DurableFixture
from psp_cdl_llmproxy import RedirectingLlmLoop
from psp_cdl_mcpproxy import binding_digest

SUITE=json.loads((Path(__file__).resolve().parents[1]/"conformance/vectors/llm/redirect-0.1.json").read_text(encoding="utf-8"))

class Fixture(DurableFixture):
    def __init__(self,settings=None):
        settings=settings or {}
        super().__init__({**settings,"postCompletion":"lockdown","base":{**settings.get("base",{}),"redirectTurns":not settings.get("disabledRedirect")}})
        saved=self.base.flags["denyPersistence"];self.base.flags["denyPersistence"]=False
        try: self.base.store.execute(self.base.actor,{"action":"putNode","nodeId":"support","nodeVersion":"1","definition":{"type":"application","agents":""}})
        finally: self.base.flags["denyPersistence"]=saved
        self.resolutions,self.policies=[],[]
        try: self.loop=RedirectingLlmLoop(self.base.store,self.base.gate,self,self.provider,settings.get("configuration",{"postCompletion":"redirect","target":"mcp://realflow/applications/support"}))
        except Exception:
            self.close()
            raise
    def plan_turn(self,p,b,data):
        result=super().plan_turn(p,b,data)
        result["state"]["threatState"]={"score":99,"marker":"SOURCE_ONLY"}
        return result
    def resolve_redirect(self,p,b,target):
        self.resolutions.append({"p":deepcopy(p),"binding":deepcopy(b),"target":target})
        if self.flags.get("throwResolve"): raise RuntimeError("PRIVATE_RESOLVER_DETAIL")
        if self.flags.get("badResolve"): return {}
        if self.flags.get("mutateResolve"): p["subjectId"],b["sessionId"]="forged","forged"
        return {"nodeId":"entry" if self.flags.get("sameTarget") else "missing" if self.flags.get("missingTarget") else "support","nodeVersion":"1","policyVersion":"target-policy","expiresAt":1000 if self.flags.get("expiredTarget") else 2001 if self.flags.get("longTarget") else 1600,**({"subjectId":"other"} if self.flags.get("resolveOwner") else {})}
    def redirect_policy(self,p,b,data):
        self.policies.append({"binding":deepcopy(b),"data":deepcopy(data)})
        if self.flags.get("throwRedirect"): raise RuntimeError("PRIVATE_REDIRECT_DETAIL")
        for flag,key,value in (("redirectCancel","cancelled",True),("redirectRevoke","revoked",True),("redirectDrift","drift",True),("redirectExpiry","now",1600)):
            if self.flags.get(flag): self.base.flags[key]=value
        digest=binding_digest(b)
        covenants=["unknown-term"] if self.flags.get("unknownRedirect") else data["retained"]["covenants"]
        if self.flags.get("mutateRedirect"): p["subjectId"],b["redirect"]["sessionId"],data["output"]["text"]="forged","forged","forged"
        return {"bindingDigest":"wrong" if self.flags.get("wrongRedirectBinding") else digest,"resources":[] if self.flags.get("emptyRedirect") else [{"classes":[],"covenants":covenants,"capabilities":["used-for-model-training"] if self.flags.get("denyRedirect") else [],"checks":{},"parameters":{},"context":{}}]}
    def sessions(self):
        db=sqlite3.connect(str(Path(self.base.directory.name)/"state.sqlite"))
        try: return [json.loads(row[0]) for row in db.execute("SELECT body FROM psp_records WHERE kind='session' ORDER BY record_key")]
        finally: db.close()

def run_case(case):
    f=None;steps=[]
    try:
        f=Fixture(case.get("settings"))
        for step in case.get("steps",[{"action":"run"}]):
            f.flags.update(step.get("flags",{}));f.base.flags.update(step.get("baseFlags",{}))
            options={**f.options,**step.get("options",{})};token=step.get("token","test-owner")
            try:
                value=f.loop.recover(token,f.base.session["sessionId"],step.get("requestId","turn-1"),options) if step["action"]=="recover" else f.loop.run(token,f.base.session["sessionId"],step.get("request",{"message":"Read synthetic data."}),options)
                steps.append({"code":"OK","value":value})
            except Exception as exc: steps.append({"code":getattr(exc,"code","UNEXPECTED_ERROR")})
        all_sessions=f.sessions();source=next(s for s in all_sessions if s["sessionId"]==f.base.session["sessionId"]);targets=[s for s in all_sessions if s["sessionId"]!=f.base.session["sessionId"]]
        for policy in f.policies:
            command=next(c for c in f.commands if c["requestId"]==policy["binding"]["requestId"])
            assert policy["binding"]["commandDigest"]==binding_digest(command)
            policy["binding"]["commandDigest"]="<command-digest>"
        for item in [*f.policies,*f.resolutions]:
            binding=item["binding"]
            assert binding["promptDigest"]==binding_digest(f.prompt(f.base.actor,binding))
            binding["promptDigest"]="<prompt-digest>"
        text=json.dumps({"steps":steps,"codes":[s["code"] for s in steps],"targets":len(targets),"version":source["version"],**f.stats(),"source":source,"targetSessions":targets,"commands":f.commands,"policies":f.policies,"resolutions":f.resolutions,"requests":f.requests}).replace(f.base.session["sessionId"],"<source>")
        for target in targets: text=text.replace(target["sessionId"],"<target>")
        for policy in f.policies: text=text.replace(policy["binding"]["redirect"]["sessionId"],"<target>")
        return json.loads(text)
    except Exception as exc: return {"code":getattr(exc,"code","UNEXPECTED_ERROR")}
    finally:
        if f: f.close()
