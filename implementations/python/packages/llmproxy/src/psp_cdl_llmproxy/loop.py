# SPDX-License-Identifier: Apache-2.0
"""Provider/tool transport and boundary enforcement; the LLM interprets PSP in context.

The host prompt contains approved interpreter/application context, preserving
natural-language conditions. Do not select nodes or evaluate conditions here.
"""
from psp_cdl_core import canonical_json
from psp_cdl_core.crypto import verify_envelope
from psp_cdl_cdl import aggregate_capabilities, evaluate_batch
from psp_cdl_api_server.service import SecurityService, ServiceError, identifier
from psp_cdl_api_server.persistence import OwnerCoordinator, StoreError, bounded, integer, MAX_STATE_BYTES
from psp_cdl_mcpproxy import McpDispatchGate, DispatchError, binding_digest
from psp_cdl_mcpproxy.observe import make_emitter, byte_length, text_bytes, scope_of

LLM_LOOP_PROFILE = "PSP-LLM-LOOP-0.1"


class LoopError(ValueError):
    def __init__(self, code):
        super().__init__(code)
        self.code = code


def copy(value, code="INVALID_REQUEST"):
    try: return bounded(value)
    except Exception: raise LoopError(code) from None


def callback(fn):
    try: return fn()
    except Exception: raise LoopError("HOST_ERROR") from None


def caps(sources, complete):
    try: return aggregate_capabilities(sources, complete)
    except Exception: raise LoopError("INVALID_CAPABILITIES") from None


def _fail(code): raise LoopError(code)


def describe_prompt(prompt):
    """Observable prompt metadata: digest and sizes only; the text travels only at inspect level."""
    s = prompt["signature"]
    return {"digest":binding_digest(prompt), "textBytes":text_bytes(prompt["data"]), "version":s["version"], "trustLevel":s.get("trustLevel", 2), "timestamp":s["timestamp"], "expires":s["expires"]}


def loop_code(exc):
    """Stable failure code for any error escaping the loop; identical mapping in both languages."""
    if isinstance(exc, (LoopError, DispatchError)): return exc.code
    if isinstance(exc, ServiceError) and exc.code in ("UNAUTHENTICATED", "FORBIDDEN"): return exc.code
    if isinstance(exc, StoreError) and exc.code in ("NOT_FOUND", "EXPIRED", "STATE_BUSY"): return exc.code
    return "HOST_ERROR"


def prompt_context(binding):
    """Required signed attributes; never include the host binding in model messages."""
    fields = {"tenant-id":"tenantId", "subject-id":"subjectId", "session-id":"sessionId", "session-version":"sessionVersion",
              "node-id":"nodeId", "node-version":"nodeVersion", "store-epoch":"epoch", "policy-version":"policyVersion",
              "authority-revision":"authorityRevision", "provider-id":"providerId", "provider-revision":"providerRevision", "registry-revision":"registryRevision"}
    return {attribute:str(binding[field]) for attribute,field in fields.items()}


class BufferedLlmLoop:
    def __init__(self, store, gate, host, provider, observe=None):
        if not isinstance(store.coordinator, OwnerCoordinator) or not isinstance(gate, McpDispatchGate) or not gate.uses_store(store) or any(
            not callable(getattr(host, name, None)) for name in ("authenticate", "now", "snapshot", "prompt", "verification", "policy", "authorize_final")
        ) or type(provider) is not dict:
            raise LoopError("INVALID_CONFIGURATION")
        invoke = provider.get("invoke")
        meta = copy({k:v for k,v in provider.items() if k != "invoke"}, "INVALID_CONFIGURATION")
        if set(meta) != {"id", "revision", "sources", "complete"} or not identifier(meta["id"]) or not identifier(meta["revision"]) or not callable(invoke):
            raise LoopError("INVALID_CONFIGURATION")
        self._emit, self._observe = make_emitter("llmproxy", observe, _fail), observe
        self._provider = {**meta, "invoke":invoke}
        self._provider_caps = caps(meta["sources"], meta["complete"])
        self._store, self._gate, self._host = store, gate, host
        self._coordinator, self._auth = store.coordinator, SecurityService(host)

    def _check(self, options, expires=9007199254740991):
        now, cancelled = self._host.now(), options["cancelled"]()
        if not integer(now) or type(cancelled) is not bool: raise LoopError("HOST_ERROR")
        if cancelled: raise LoopError("CANCELLED")
        if now >= options["deadline"]: raise LoopError("DEADLINE_EXCEEDED")
        if now >= expires: raise LoopError("STALE_AUTHORITY")

    def _principal(self, token, expected=None):
        p = self._auth.authenticate(token)
        if "models:invoke" not in p["scopes"] or expected and any(p[k] != expected[k] for k in ("tenantId", "subjectId")):
            raise LoopError("FORBIDDEN")
        return p

    def _snapshot(self, p, session):
        a = copy(callback(lambda:self._host.snapshot(copy(p), copy(session))), "INVALID_AUTHORITY")
        if type(a) is not dict or set(a) != {"revision", "policyVersion", "providerId", "providerRevision", "registryRevision", "expires", "releaseSources", "releaseComplete"} or not identifier(a["revision"]) or a["policyVersion"] != session["policyVersion"] or a["providerId"] != self._provider["id"] or a["providerRevision"] != self._provider["revision"] or a["registryRevision"] != self._gate.registry_revision or not integer(a["expires"]):
            raise LoopError("STALE_AUTHORITY")
        caps(a["releaseSources"], a["releaseComplete"])
        return a

    def _verify(self, p, binding, prompt):
        policy = callback(lambda:self._host.verification(copy(p), copy(binding)))
        context = self._verification_context(binding)
        try:
            if type(policy) is not dict or type(policy.get("keys")) is not list or any(k.get("allowUnscoped") is not False for k in policy["keys"]):
                raise LoopError("PROMPT_REJECTED")
            e = verify_envelope(prompt, {**policy, "context":context, "allowedAttributes":[*context,*self._prompt_attributes()], "now":self._host.now()})
            if e["signature"]["sectionType"] != "system" or e["signature"]["contentType"] != "text" or e["signature"].get("trustLevel", 2) not in (1, 2):
                raise LoopError("PROMPT_REJECTED")
        except Exception: raise LoopError("PROMPT_REJECTED") from None

    def _decide(self, p, binding, data, phase, recipient_caps):
        context = {**binding, "phase":phase, "dataDigest":binding_digest(data)}
        policy = copy(callback(lambda:self._host.policy(copy(p), copy(context), copy(data), phase)), "INVALID_POLICY")
        if type(policy) is not dict or set(policy) != {"bindingDigest", "resources"} or policy["bindingDigest"] != binding_digest(context) or type(policy["resources"]) is not list or not policy["resources"]:
            raise LoopError("INVALID_POLICY")
        inputs = []
        for resource in policy["resources"]:
            if type(resource) is not dict: raise LoopError("INVALID_POLICY")
            inputs.append({**resource, "capabilities":caps([{"id":"recipient", "capabilities":recipient_caps}, {"id":"path", "capabilities":resource.get("capabilities")}], True)})
        verdict = evaluate_batch(inputs)
        self._emit("cdl.decision", scope_of(binding), {"phase":phase, "decision":verdict["decision"], "reasonCodes":list(verdict["reasonCodes"]), "resourceCount":len(inputs)})
        if verdict["decision"] == "unsupported": raise LoopError("UNSUPPORTED_POLICY")
        if verdict["decision"] != "allow": raise LoopError("OUTPUT_DENIED" if phase == "release" else "POLICY_DENIED")
        return context

    def _verification_context(self,binding):return prompt_context(binding)

    def _prompt_attributes(self): return []

    def _context_messages(self): return []

    def _load_prompt(self,p,binding,options,reservation):
        prompt=copy(callback(lambda:self._host.prompt(copy(p),copy(binding))),"PROMPT_REJECTED")
        self._verify(p,binding,prompt)
        return prompt

    def _inference_prompt(self,p,binding,prompt,options,reservation): return prompt

    def run(self, token, session_id, request, options):
        try:
            value = copy(request)
            if type(value) is not dict or set(value) != {"message"} or type(value["message"]) is not str or not identifier(session_id) or type(options) is not dict or not integer(options.get("deadline")) or not callable(options.get("cancelled")) or not integer(options.get("maxSteps")) or not 1 <= options["maxSteps"] <= 32:
                raise LoopError("INVALID_REQUEST")
            options = {k:options[k] for k in ("deadline", "cancelled", "maxSteps")}
            p = self._principal(token)
            actor = {k:p[k] for k in ("tenantId", "subjectId")}
            turn = scope_of({"sessionId":session_id})
            self._check(options)
            self._emit("turn.start", turn, {"inputBytes":text_bytes(value["message"]), "maxSteps":options["maxSteps"], "deadline":options["deadline"], "providerId":self._provider["id"], "providerRevision":self._provider["revision"]}, lambda:{"message":value["message"]})
            def initialize(reservation):
                session = self._store.execute(actor, {"action":"getSession", "sessionId":session_id})
                if session["status"] != "running": raise LoopError("INACTIVE_SESSION")
                authority = self._snapshot(p, session)
                self._check(options, min(authority["expires"], session["expiresAt"]))
                binding = {"tenantId":p["tenantId"], "subjectId":p["subjectId"], "sessionId":session_id, "sessionVersion":session["version"],
                           "nodeId":session["nodeId"], "nodeVersion":session["nodeVersion"], "epoch":self._store.epoch, "policyVersion":authority["policyVersion"],
                           "authorityRevision":authority["revision"], "providerId":self._provider["id"], "providerRevision":self._provider["revision"],
                           "registryRevision":authority["registryRevision"], "deadline":options["deadline"]}
                prompt = self._load_prompt(p,binding,options,reservation)
                return session, authority, binding, prompt
            session, authority, binding, prompt = self._coordinator.run_reserved(actor, initialize)
            expires = min(authority["expires"], session["expiresAt"])
            self._emit("session.loaded", turn, {"sessionVersion":session["version"], "nodeId":session["nodeId"], "nodeVersion":session["nodeVersion"], "policyVersion":authority["policyVersion"], "authorityRevision":authority["revision"], "registryRevision":authority["registryRevision"], "expires":expires, "stateBytes":byte_length(session["state"])}, lambda:{"state":session["state"]})
            self._emit("prompt.loaded", turn, describe_prompt(prompt), lambda:{"text":prompt["data"]})
            def fresh(check_prompt=True):
                self._check(options, expires)
                self._principal(token, p)
                if canonical_json(self._store.execute(actor, {"action":"getSession", "sessionId":session_id})) != canonical_json(session): raise LoopError("STALE_SESSION")
                if canonical_json(self._snapshot(p, session)) != canonical_json(authority): raise LoopError("STALE_AUTHORITY")
                if check_prompt:self._verify(p, binding, prompt)
                self._check(options, expires)
            tools = self._gate.list_tools(token, session_id, options, p)
            self._emit("tools.listed", turn, {"count":len(tools), "names":[t["name"] for t in tools]})
            messages = [{"role":"system", "content":prompt["data"]}, *copy(self._context_messages()), {"role":"user", "content":value["message"]}]
            for step in range(1, options["maxSteps"] + 1):
                step_binding = None
                at = scope_of({"sessionId":session_id, "step":step})
                self._emit("step.start", at, {"step":step})
                def infer(reservation):
                    nonlocal prompt,step_binding
                    fresh(False)
                    before = binding_digest(prompt)
                    prompt=self._inference_prompt(p,binding,prompt,options,reservation)
                    if binding_digest(prompt) != before: self._emit("prompt.replaced", at, describe_prompt(prompt), lambda:{"text":prompt["data"]})
                    messages[0]={"role":"system","content":prompt["data"]}
                    step_binding={**binding,"step":step,"promptDigest":binding_digest(prompt)}
                    fresh()
                    provider_request = copy({"messages":messages, "tools":tools})
                    self._emit("prompt.assembled", at, {"messageCount":len(messages), "bytes":byte_length(provider_request), "toolCount":len(tools), "promptDigest":step_binding["promptDigest"]}, lambda:{"messages":messages})
                    self._decide(p, step_binding, {"request":provider_request}, "inference", self._provider_caps)
                    fresh()
                    self._emit("inference.start", at, {"bytes":byte_length(provider_request), "messageCount":len(messages)})
                    try: raw = self._provider["invoke"](copy(provider_request), {"deadline":options["deadline"], "cancelled":options["cancelled"]})
                    except Exception:
                        self._emit("inference.end", at, {"ok":False})
                        self._check(options, expires)
                        raise LoopError("PROVIDER_FAILED") from None
                    self._emit("inference.end", at, {"ok":True})
                    self._check(options, expires)
                    candidate = copy(raw, "INVALID_RESPONSE")
                    if type(candidate) is not dict: raise LoopError("INVALID_RESPONSE")
                    kind = candidate.get("type")
                    self._emit("model.candidate", at, {"type":"tool" if kind == "tool" else "final" if kind == "final" else "invalid", "toolName":candidate["name"] if type(candidate.get("name")) is str else None, "textBytes":text_bytes(candidate["text"]) if type(candidate.get("text")) is str else None}, lambda:{"candidate":candidate})
                    if kind == "tool":
                        if set(candidate) != {"type", "name", "arguments"} or type(candidate["name"]) is not str or type(candidate["arguments"]) is not dict: raise LoopError("INVALID_RESPONSE")
                        if not any(t["name"] == candidate["name"] for t in tools): raise LoopError("TOOL_NOT_ALLOWED")
                        if step == options["maxSteps"]: raise LoopError("STEP_LIMIT")
                        fresh()
                        return {"candidate":candidate}
                    if kind != "final" or set(candidate) != {"type", "text"} or type(candidate["text"]) is not str: raise LoopError("INVALID_RESPONSE")
                    data = copy({"request":provider_request, "candidate":candidate})
                    context = self._decide(p, step_binding, data, "release", caps(authority["releaseSources"], authority["releaseComplete"]))
                    if callback(lambda:self._host.authorize_final(copy(p), copy(context), copy(data))) is not True: raise LoopError("COMPLETION_DENIED")
                    output_digest = binding_digest({"text":candidate["text"]})
                    self._emit("final.authorized", at, {"step":step, "outputDigest":output_digest, "textBytes":text_bytes(candidate["text"])}, lambda:{"text":candidate["text"]})
                    fresh()
                    return {"output":{"text":candidate["text"], "provenance":{"profile":LLM_LOOP_PROFILE, "providerId":self._provider["id"],
                            "providerRevision":self._provider["revision"], "outputDigest":output_digest, "trustLevel":5, "steps":step}}}
                result = self._coordinator.run_reserved(actor, infer)
                if "output" in result:
                    self._emit("turn.buffered", turn, {"steps":step, "outputDigest":result["output"]["provenance"]["outputDigest"]})
                    return result["output"]
                candidate = result["candidate"]
                self._emit("dispatch.requested", at, {"step":step, "toolName":candidate["name"], "argumentBytes":byte_length(candidate["arguments"])}, lambda:{"arguments":candidate["arguments"]})
                guard_error = []
                def authorize_dispatch(current, recipient_caps):
                    try:
                        if canonical_json(current) != canonical_json(session): raise LoopError("STALE_SESSION")
                        fresh()
                        self._decide(p, step_binding, copy({"request":{"messages":messages, "tools":tools}, "candidate":candidate}), "tool", recipient_caps)
                        fresh()
                        return True
                    except Exception as exc:
                        guard_error.append(exc)
                        return False
                try:
                    output = self._gate.call_tool(token, session_id, {"name":candidate["name"], "arguments":candidate["arguments"]}, {**options, "authorizeDispatch":authorize_dispatch}, p)
                except Exception:
                    if guard_error: raise guard_error[0]
                    raise
                # Refresh cannot make a result produced under an expired prompt usable.
                self._coordinator.run(actor, fresh)
                messages.extend([{"role":"assistant", "call":{"name":candidate["name"], "arguments":candidate["arguments"]}}, {"role":"tool", "name":candidate["name"], "data":output["data"]}])
                self._emit("transcript.grew", at, {"messageCount":len(messages), "bytes":byte_length({"messages":messages, "tools":tools}), "toolName":candidate["name"], "dataBytes":byte_length(output["data"]), "limit":MAX_STATE_BYTES}, lambda:{"data":output["data"]})
                copy({"messages":messages, "tools":tools})
            raise LoopError("STEP_LIMIT")
        except Exception as exc:
            code = loop_code(exc)
            self._emit("turn.failed", scope_of({"sessionId":session_id}), {"code":code})
            if isinstance(exc, LoopError): raise
            raise LoopError(code) from None
