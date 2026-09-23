# SPDX-License-Identifier: Apache-2.0
"""Completed workflow state stays frozen while a separate durable scope advances."""
from psp_cdl_cdl import aggregate_capabilities
from psp_cdl_api_server.service import identifier
from psp_cdl_api_server.persistence import StoreError,integer
from psp_cdl_api_server.scoped_state import SCOPED_PROFILE,valid_scope,valid_scoped_completion,valid_threat_policy,exact
from psp_cdl_mcpproxy import binding_digest
from .durable import DurableLlmLoop,call,same,actor
from .loop import LoopError,copy,prompt_context

def scoped_prompt_context(binding):
    scope=binding.get("scope")
    if not valid_scope(scope):raise LoopError("INVALID_SCOPED_STATE")
    return {**prompt_context(binding),"post-completion":"scoped","scope-id":scope["id"],"scope-version":scope["version"],"scope-digest":binding_digest(scope),"threat-policy-id":scope["threatPolicy"]["id"],"threat-policy-version":scope["threatPolicy"]["version"]}

class ScopedLlmLoop(DurableLlmLoop):
    _completion_policy="scoped"
    def __init__(self,store,gate,host,provider,configuration=None):
        super().__init__(store,gate,host,provider,{"postCompletion":"lockdown"})
        if not store.scoped_turns or any(not callable(getattr(host,k,None)) for k in ("application_threat","scoped_prompt","scope_boundary","plan_scoped_turn")):raise LoopError("INVALID_CONFIGURATION")
        config=copy(configuration,"UNSUPPORTED_POST_COMPLETION")
        if not exact(config,"postCompletion,scope") or config["postCompletion"]!="scoped" or not exact(config["scope"],"id,system,threatPolicy,version"):raise LoopError("UNSUPPORTED_POST_COMPLETION")
        scope=config["scope"]
        if not identifier(scope["id"]) or not identifier(scope["version"]) or type(scope["system"]) is not str or not scope["system"] or scope["threatPolicy"] is not None and not valid_threat_policy(scope["threatPolicy"]):raise LoopError("UNSUPPORTED_POST_COMPLETION")
        self._definition=scope

    def _verification_context(self,binding):return scoped_prompt_context(binding) if binding.get("postCompletion")=="scoped" else super()._verification_context(binding)
    def _verify(self,p,binding,prompt):
        super()._verify(p,binding,prompt)
        if binding.get("postCompletion")=="scoped" and binding_digest({"system":prompt["data"]})!=binding["scope"]["systemDigest"]:raise LoopError("PROMPT_REJECTED")

    def _prepare_commit(self,p,binding,command,options):
        scope,threat_state=None,None
        if command["complete"]:
            session=self._store.execute(actor(p),{"action":"getSession","sessionId":command["sessionId"]})
            threat=copy(call(lambda:self._host.application_threat(copy(p),copy({**binding,"requestId":command["requestId"],"postCompletion":"scoped"}),copy(session))),"INVALID_SCOPED_STATE")
            if not exact(threat,"policy,state") or not valid_threat_policy(threat["policy"]) or type(threat["state"]) is not dict:raise LoopError("INVALID_SCOPED_STATE")
            scope={"id":self._definition["id"],"version":self._definition["version"],"systemDigest":binding_digest({"system":self._definition["system"]}),"threatPolicy":self._definition["threatPolicy"] or threat["policy"]}
            threat_state=threat["state"]
        self._check(options)
        return {**command,"action":"commitScopedWorkflowTurn","scope":scope,"threatState":threat_state}

    @staticmethod
    def _present(receipt,recovered):
        if type(receipt.get("scoped")) is dict and receipt["scoped"].get("outcome")=="violation":raise LoopError("PSP_POST_COMPLETION_VIOLATION")
        return {**DurableLlmLoop._present(receipt,recovered),**({"scoped":copy(receipt["scoped"])} if "scoped" in receipt else {})}

    def run(self,token,session_id,request,options):return self._boundary(lambda:self._run_scoped(token,session_id,request,options))

    def _run_scoped(self,token,session_id,request,options):
        value,controls=copy(request),self._controls(options)
        if not exact(value,"message") or type(value["message"]) is not str or not identifier(session_id) or not identifier(options.get("requestId")) or not integer(options.get("expectedVersion")) or options["expectedVersion"]<1 or not integer(options.get("maxSteps")) or not 1<=options["maxSteps"]<=32:raise LoopError("INVALID_REQUEST")
        options={**controls,**{k:options[k] for k in ("requestId","expectedVersion","maxSteps")}}
        p=self._identity(token,"sessions:write");owner=actor(p);self._check(controls)
        session=self._coordinator.run(owner,lambda:self._store.execute(owner,{"action":"getSession","sessionId":session_id}))
        if session["status"]=="running":return super().run(token,session_id,value,options)
        state=session.get("llmCompletion")
        if session["status"]!="completed" or not valid_scoped_completion(state):raise LoopError("INACTIVE_SESSION")
        expected={"id":self._definition["id"],"version":self._definition["version"],"systemDigest":binding_digest({"system":self._definition["system"]}),"threatPolicy":self._definition["threatPolicy"] or state["scope"]["threatPolicy"]}
        if not same(state["scope"],expected):raise LoopError("SCOPED_STATE_MISMATCH")
        input_digest=binding_digest(value);old=None
        try:old=self._store.execute(owner,{"action":"getTurn","sessionId":session_id,"requestId":options["requestId"]})
        except StoreError as exc:
            if exc.code!="NOT_FOUND":raise
        if old is not None:raise LoopError("TURN_ALREADY_COMMITTED" if old["inputDigest"]==input_digest and old["sessionVersion"]==options["expectedVersion"]+1 else "IDEMPOTENCY_CONFLICT")
        if session["version"]!=options["expectedVersion"]:raise LoopError("STALE_SESSION")
        completed=self._store.execute(owner,{"action":"getTurn","sessionId":session_id,"requestId":state["requestId"]})
        if type(completed.get("output")) is not dict or type(completed["output"].get("text")) is not str or type(completed.get("retained")) is not dict:raise LoopError("INVALID_SCOPED_STATE")
        authority=self._snapshot(p,session);expires=min(authority["expires"],session["expiresAt"])
        binding={**owner,"sessionId":session_id,"sessionVersion":session["version"],**{k:session[k] for k in ("nodeId","nodeVersion")},"epoch":self._store.epoch,"policyVersion":authority["policyVersion"],"authorityRevision":authority["revision"],"providerId":self._provider["id"],"providerRevision":self._provider["revision"],"registryRevision":authority["registryRevision"],"deadline":options["deadline"],"requestId":options["requestId"],"inputDigest":input_digest,"postCompletion":"scoped","scope":state["scope"],"scopeDigest":binding_digest(state["scope"])}
        prompt=None;threat_state=copy(state["threatState"]);retained=copy(state["retained"]);output=None;violation_phase=None;data=None
        def fresh(version=None):
            self._check(controls,expires);live=self._identity(token,"sessions:write",p)
            current=self._store.execute(owner,{"action":"getSession","sessionId":session_id})
            if (not same(current,session)) if version is None else current["version"]!=version or current["status"]!="completed":raise LoopError("STALE_SESSION")
            if not same(self._snapshot(live,current),authority):raise LoopError("STALE_AUTHORITY")
            if prompt is not None:self._verify(live,binding,prompt)
            self._check(controls,expires)
        def boundary(phase,candidate=None):
            nonlocal threat_state,violation_phase
            info={"request":value,"completedOutput":completed["output"],"completedRetained":completed["retained"],"retained":state["retained"],"threatState":threat_state,"candidate":candidate}
            bound={**binding,"phase":phase,"threatDigest":binding_digest(threat_state),"dataDigest":binding_digest(info)}
            decision=copy(call(lambda:self._host.scope_boundary(copy(p),copy(bound),copy(info))),"INVALID_SCOPE_DECISION")
            if not exact(decision,"bindingDigest,decision,threatState") or decision["bindingDigest"]!=binding_digest(bound) or decision["decision"] not in ("allow","deny","unsupported") or type(decision["threatState"]) is not dict:raise LoopError("INVALID_SCOPE_DECISION")
            if decision["decision"]=="unsupported":raise LoopError("UNSUPPORTED_SCOPE")
            threat_state=decision["threatState"];fresh()
            if decision["decision"]=="deny":violation_phase=phase;return False
            return True
        def infer():
            nonlocal prompt,retained,output,data
            fresh()
            if not boundary("ingress"):return
            prompt=copy(call(lambda:self._host.scoped_prompt(copy(p),copy(binding))),"PROMPT_REJECTED");fresh()
            provider_request={"messages":[{"role":"system","content":prompt["data"]},{"role":"assistant","content":completed["output"]["text"]},{"role":"user","content":value["message"]}],"tools":[]}
            data=copy({"request":provider_request,"retained":retained,"completedRetained":completed["retained"]})
            self._decide(p,binding,data,"inference",aggregate_capabilities(self._provider["sources"],self._provider["complete"]));fresh()
            try:raw=self._provider["invoke"](copy(provider_request),{**controls})
            except Exception:
                self._check(controls,expires)
                raise LoopError("PROVIDER_FAILED") from None
            fresh();candidate=copy(raw,"INVALID_RESPONSE")
            if type(candidate) is dict and candidate.get("type")=="tool":raise LoopError("TOOL_NOT_ALLOWED")
            if not exact(candidate,"text,type") or candidate["type"]!="final" or type(candidate["text"]) is not str:raise LoopError("INVALID_RESPONSE")
            if not boundary("egress",candidate):return
            data=copy({**data,"candidate":candidate})
            context=self._decide(p,binding,data,"release",aggregate_capabilities(authority["releaseSources"],authority["releaseComplete"]));fresh()
            if call(lambda:self._host.authorize_final(copy(p),copy(context),copy(data))) is not True:raise LoopError("COMPLETION_DENIED")
            plan=copy(call(lambda:self._host.plan_scoped_turn(copy(p),copy({**context,"threatDigest":binding_digest(threat_state)}),copy(data))),"INVALID_PLAN")
            if not exact(plan,"retained") or type(plan["retained"]) is not dict:raise LoopError("INVALID_PLAN")
            retained=plan["retained"]
            output={"text":candidate["text"],"provenance":{"profile":"PSP-LLM-LOOP-0.1","providerId":self._provider["id"],"providerRevision":self._provider["revision"],"outputDigest":binding_digest({"text":candidate["text"]}),"trustLevel":5,"steps":1}};fresh()
        self._coordinator.run(owner,infer)
        command={"action":"commitScopedTurn","requestId":options["requestId"],"sessionId":session_id,"expectedVersion":options["expectedVersion"],**{k:session[k] for k in ("nodeId","nodeVersion","policyVersion")},"inputDigest":input_digest,"scopeDigest":binding_digest(state["scope"]),"threatState":threat_state,"retained":retained,"output":output,"violationPhase":violation_phase}
        guard_error=[]
        def guard(context):
            try:
                if context["replay"]:raise LoopError("TURN_ALREADY_COMMITTED")
                fresh();self._authorize_commit(p,binding,context,options);fresh();return True
            except Exception as exc:guard_error.append(exc);return False
        try:receipt=self._store.execute(owner,command,guard)
        except Exception:
            if guard_error:raise guard_error[0]
            raise
        if violation_phase is not None:raise LoopError("PSP_POST_COMPLETION_VIOLATION")
        def release():
            fresh(receipt["sessionVersion"])
            self._decide(p,{**binding,"committedVersion":receipt["sessionVersion"]},copy({**data,"retained":retained}),"release",aggregate_capabilities(authority["releaseSources"],authority["releaseComplete"]))
            fresh(receipt["sessionVersion"])
            return self._present(receipt,False)
        return self._coordinator.run(owner,release)
