# SPDX-License-Identifier: Apache-2.0
"""Boundary-triggered refresh; signing and compatibility remain host authorities."""
import re
from psp_cdl_core import canonical_version
from psp_cdl_api_server.service import SecurityService, ServiceError
from psp_cdl_api_server.persistence import StoreError, integer, valid_prompt_state, compare_prompt_versions, PROMPT_REFRESH_PROFILE
from psp_cdl_mcpproxy import binding_digest
from .loop import BufferedLlmLoop, LoopError, copy
from .durable import DurableLlmLoop, call, actor

ATTRIBUTES=["refresh-policy","refresh-interval","refresh-grace"]

def describe(prompt):
    s=prompt["signature"];a=s.get("attributes",{})
    policies=sorted(a.get("refresh-policy","expiration").split("|"))
    if not policies or any(p not in ("expiration","interval") or policies.index(p)!=i for i,p in enumerate(policies)): raise LoopError("UNSUPPORTED_REFRESH")
    def decimal(value,default):
        if value is None:return default
        if not re.fullmatch(r"0|[1-9][0-9]*",value) or len(value)>16:raise LoopError("INVALID_REFRESH")
        n=int(value)
        if not integer(n):raise LoopError("INVALID_REFRESH")
        return n
    interval=decimal(a.get("refresh-interval"),0);grace=decimal(a.get("refresh-grace"),300)
    if ("interval" in policies)!=(interval>0) or "interval" not in policies and "refresh-interval" in a:raise LoopError("INVALID_REFRESH")
    text=prompt["data"].replace("\r\n","\n").replace("\r","\n").strip("\t\n ")
    return {"version":canonical_version(s["version"]),"digest":binding_digest({"text":text,"trustLevel":s.get("trustLevel",2),"priority":s.get("priority",50),"policies":policies,"interval":interval,"grace":grace}),"policies":policies,"interval":interval,"grace":grace,"timestamp":s["timestamp"],"expires":s["expires"],"turnCount":0,"refreshCount":0}

def saved(store,p,b):
    try:
        result=store.execute(actor(p),{"action":"getPromptState","sessionId":b["sessionId"]})
        if not valid_prompt_state(result["state"]):raise LoopError("INVALID_REFRESH_STATE")
        return result
    except StoreError as exc:
        if exc.code=="NOT_FOUND":return None
        raise

def pinned(store,p,b,prompt):
    r=saved(store,p,b);d=describe(prompt)
    if r is None or r["state"]["version"]!=d["version"] or r["state"]["digest"]!=d["digest"]:raise LoopError("STALE_PROMPT")

class RefreshBuffer(BufferedLlmLoop):
    def __init__(self,store,gate,host,provider,refresh_host,on_prompt,token,options):
        super().__init__(store,gate,host,provider)
        self.refresh_host,self.on_prompt,self.token,self.options=refresh_host,on_prompt,token,options
        self.current,self.revision=None,0
    def _prompt_attributes(self):return ATTRIBUTES
    def _verify(self,p,b,prompt):
        super()._verify(p,b,prompt)
        pinned(self._store,p,b,prompt)
    def ensure(self,p,b):
        self._check(self.options)
        live=SecurityService(self._host).authenticate(self.token)
        if any(live[k]!=p[k] for k in ("tenantId","subjectId")) or any(s not in live["scopes"] for s in ("models:invoke","sessions:write")):raise LoopError("FORBIDDEN")
        s=self._store.execute(actor(p),{"action":"getSession","sessionId":b["sessionId"]})
        if s["version"]!=b["sessionVersion"] or s["status"]!="running":raise LoopError("STALE_SESSION")
        a=self._snapshot(live,s);self._check(self.options,min(a["expires"],s["expiresAt"]))
        if a["revision"]!=b["authorityRevision"] or a["policyVersion"]!=b["policyVersion"]:raise LoopError("STALE_AUTHORITY")
    @staticmethod
    def due(state,now):
        if now>=state["expires"] or "expiration" in state["policies"] and state["expires"]-now<=state["grace"]:return "expiration"
        if "interval" in state["policies"] and state["turnCount"]>=state["interval"]:return "interval"
        return None
    def audit(self,p,b,signal,details):
        try:ok=self.refresh_host.audit_refresh(copy(p),copy({"profile":PROMPT_REFRESH_PROFILE,"signal":signal,"binding":b,"at":self._host.now(),**details}))
        except Exception:raise LoopError("AUDIT_FAILED") from None
        if ok is not True:raise LoopError("AUDIT_FAILED")
    def install(self,p,b,reservation,trigger):
        previous=self.current["state"] if self.current else None
        started=self._host.now()
        try:
            self.ensure(p,b)
            request={"session_id":b["sessionId"],"current_version":previous["version"] if previous else None,"trigger":trigger or "initial","turn_count":previous["turnCount"] if previous else 0}
            prompt=copy(call(lambda:self.refresh_host.refresh(copy(p),copy(b),copy(request)) if trigger else self._host.prompt(copy(p),copy({**b,"refresh":request}))),"INVALID_REFRESH")
            super()._verify(p,b,prompt);next_state=describe(prompt)
            if previous:
                comparison=compare_prompt_versions(next_state["version"],previous["version"])
                if comparison<0:raise LoopError("PROMPT_ROLLBACK")
                if comparison==0 and next_state["digest"]!=previous["digest"]:raise LoopError("PROMPT_VERSION_CONFLICT")
                if next_state["timestamp"]<started or next_state["timestamp"]<=previous["timestamp"] or next_state["expires"]-self._host.now()<=next_state["grace"]:raise LoopError("REFRESH_NOT_FRESH")
                next_state["refreshCount"]=previous["refreshCount"]+1
            if call(lambda:self.refresh_host.authorize_refresh(copy(p),copy({**b,"trigger":trigger or "initial"}),copy(previous),copy(prompt))) is not True:raise LoopError("REFRESH_DENIED")
            self.ensure(p,b);super()._verify(p,b,prompt)
            guard_error=[]
            def guard(_):
                try:
                    self.ensure(p,b);super(RefreshBuffer,self)._verify(p,b,prompt)
                    return True
                except Exception as exc:
                    guard_error.append(exc)
                    return False
            try:result=self._store.execute(actor(p),{"action":"putPromptState","sessionId":b["sessionId"],"expectedVersion":b["sessionVersion"],"refreshRevision":self.revision,"state":next_state},guard,reservation)
            except Exception:
                if guard_error:raise guard_error[0]
                raise
            self.current,self.revision=result,result["revision"]
            self.audit(p,b,"prompt_refreshed" if trigger else "prompt_initialized",{"trigger":trigger or "initial","previousVersion":previous["version"] if previous else None,"version":next_state["version"],"digest":next_state["digest"]})
            self.ensure(p,b);self._verify(p,b,prompt);self.on_prompt(prompt)
            return prompt
        except Exception as exc:
            code=exc.code if isinstance(exc,LoopError) or isinstance(exc,StoreError) and exc.code in ("STATE_CONFLICT","PERSISTENCE_DENIED") or isinstance(exc,ServiceError) and exc.code in ("UNAUTHENTICATED","FORBIDDEN") else "HOST_ERROR"
            if code!="AUDIT_FAILED":self.audit(p,b,"prompt_refresh_rollback" if code=="PROMPT_ROLLBACK" else "prompt_refresh_failed",{"trigger":trigger or "initial","previousVersion":previous["version"] if previous else None,"code":code})
            raise LoopError(code) from None
    def _load_prompt(self,p,b,options,reservation):
        self.current=saved(self._store,p,b);self.revision=self.current["revision"] if self.current else 0
        if self.current and self.current["sessionVersion"]!=b["sessionVersion"]:raise LoopError("STALE_PROMPT")
        trigger=self.due(self.current["state"],self._host.now()) if self.current else None
        if self.current is None or trigger:return self.install(p,b,reservation,trigger)
        prompt=copy(call(lambda:self._host.prompt(copy(p),copy({**b,"refresh":{"current_version":self.current["state"]["version"],"trigger":"binding","turn_count":self.current["state"]["turnCount"]}}))),"INVALID_REFRESH")
        self._verify(p,b,prompt)
        self.audit(p,b,"prompt_bound",{"trigger":"binding","previousVersion":self.current["state"]["version"],"version":self.current["state"]["version"],"digest":self.current["state"]["digest"]})
        self.ensure(p,b);self._verify(p,b,prompt);self.on_prompt(prompt)
        return prompt
    def _inference_prompt(self,p,b,prompt,options,reservation):
        current=saved(self._store,p,b)
        if current is None or current["revision"]!=self.revision or current["sessionVersion"]!=b["sessionVersion"]:raise LoopError("STALE_PROMPT")
        trigger=self.due({**current["state"],"expires":min(current["state"]["expires"],prompt["signature"]["expires"])},self._host.now())
        return self.install(p,b,reservation,trigger) if trigger else prompt

class RefreshingLlmLoop(DurableLlmLoop):
    def __init__(self,store,gate,host,provider,configuration=None):
        super().__init__(store,gate,host,provider,configuration)
        if not store.prompt_refresh or any(not callable(getattr(host,k,None)) for k in ("refresh","authorize_refresh","audit_refresh")):raise LoopError("INVALID_CONFIGURATION")
    def _prompt_attributes(self):return ATTRIBUTES
    def _verify(self,p,b,prompt):
        super()._verify(p,b,prompt)
        pinned(self._store,p,b,prompt)
    def _make_buffered(self,host,on_prompt,token,session,options):return RefreshBuffer(self._store,self._gate,host,self._provider,self._host,on_prompt,token,options)
    def _turn_command(self,command,buffered):return {**command,"action":"commitRefreshedTurn","refreshRevision":buffered.revision}
