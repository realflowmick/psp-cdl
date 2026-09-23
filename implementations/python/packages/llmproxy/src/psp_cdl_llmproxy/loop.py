# SPDX-License-Identifier: Apache-2.0
"""Bounded host-embedded model/tool loop. No implicit credentials or provider SDK."""
from psp_cdl_core import canonical_json
from psp_cdl_core.crypto import verify_envelope
from psp_cdl_cdl import aggregate_capabilities, evaluate_batch
from psp_cdl_api_server.service import SecurityService, ServiceError, identifier
from psp_cdl_api_server.persistence import OwnerCoordinator, StoreError, bounded, integer
from psp_cdl_mcpproxy import McpDispatchGate, DispatchError, binding_digest

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


def prompt_context(binding):
    """Required signed attributes; never include the host binding in model messages."""
    fields = {"tenant-id":"tenantId", "subject-id":"subjectId", "session-id":"sessionId", "session-version":"sessionVersion",
              "node-id":"nodeId", "node-version":"nodeVersion", "store-epoch":"epoch", "policy-version":"policyVersion",
              "authority-revision":"authorityRevision", "provider-id":"providerId", "provider-revision":"providerRevision", "registry-revision":"registryRevision"}
    return {attribute:str(binding[field]) for attribute,field in fields.items()}


class BufferedLlmLoop:
    def __init__(self, store, gate, host, provider):
        if not isinstance(store.coordinator, OwnerCoordinator) or not isinstance(gate, McpDispatchGate) or not gate.uses_store(store) or any(
            not callable(getattr(host, name, None)) for name in ("authenticate", "now", "snapshot", "prompt", "verification", "policy", "authorize_final")
        ) or type(provider) is not dict:
            raise LoopError("INVALID_CONFIGURATION")
        invoke = provider.get("invoke")
        meta = copy({k:v for k,v in provider.items() if k != "invoke"}, "INVALID_CONFIGURATION")
        if set(meta) != {"id", "revision", "sources", "complete"} or not identifier(meta["id"]) or not identifier(meta["revision"]) or not callable(invoke):
            raise LoopError("INVALID_CONFIGURATION")
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
        context = prompt_context(binding)
        try:
            if type(policy) is not dict or type(policy.get("keys")) is not list or any(k.get("allowUnscoped") is not False for k in policy["keys"]):
                raise LoopError("PROMPT_REJECTED")
            e = verify_envelope(prompt, {**policy, "context":context, "allowedAttributes":list(context), "now":self._host.now()})
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
        decision = evaluate_batch(inputs)["decision"]
        if decision == "unsupported": raise LoopError("UNSUPPORTED_POLICY")
        if decision != "allow": raise LoopError("OUTPUT_DENIED" if phase == "release" else "POLICY_DENIED")
        return context

    def run(self, token, session_id, request, options):
        try:
            value = copy(request)
            if type(value) is not dict or set(value) != {"message"} or type(value["message"]) is not str or not identifier(session_id) or type(options) is not dict or not integer(options.get("deadline")) or not callable(options.get("cancelled")) or not integer(options.get("maxSteps")) or not 1 <= options["maxSteps"] <= 32:
                raise LoopError("INVALID_REQUEST")
            options = {k:options[k] for k in ("deadline", "cancelled", "maxSteps")}
            p = self._principal(token)
            actor = {k:p[k] for k in ("tenantId", "subjectId")}
            self._check(options)
            def initialize():
                session = self._store.execute(actor, {"action":"getSession", "sessionId":session_id})
                if session["status"] != "running": raise LoopError("INACTIVE_SESSION")
                authority = self._snapshot(p, session)
                self._check(options, min(authority["expires"], session["expiresAt"]))
                binding = {"tenantId":p["tenantId"], "subjectId":p["subjectId"], "sessionId":session_id, "sessionVersion":session["version"],
                           "nodeId":session["nodeId"], "nodeVersion":session["nodeVersion"], "epoch":self._store.epoch, "policyVersion":authority["policyVersion"],
                           "authorityRevision":authority["revision"], "providerId":self._provider["id"], "providerRevision":self._provider["revision"],
                           "registryRevision":authority["registryRevision"], "deadline":options["deadline"]}
                prompt = copy(callback(lambda:self._host.prompt(copy(p), copy(binding))), "PROMPT_REJECTED")
                self._verify(p, binding, prompt)
                return session, authority, binding, prompt
            session, authority, binding, prompt = self._coordinator.run(actor, initialize)
            expires = min(authority["expires"], session["expiresAt"])
            def fresh():
                self._check(options, expires)
                self._principal(token, p)
                if canonical_json(self._store.execute(actor, {"action":"getSession", "sessionId":session_id})) != canonical_json(session): raise LoopError("STALE_SESSION")
                if canonical_json(self._snapshot(p, session)) != canonical_json(authority): raise LoopError("STALE_AUTHORITY")
                self._verify(p, binding, prompt)
                self._check(options, expires)
            tools = self._gate.list_tools(token, session_id, options, p)
            messages = [{"role":"system", "content":prompt["data"]}, {"role":"user", "content":value["message"]}]
            for step in range(1, options["maxSteps"] + 1):
                step_binding = {**binding, "step":step, "promptDigest":binding_digest(prompt)}
                def infer():
                    fresh()
                    provider_request = copy({"messages":messages, "tools":tools})
                    self._decide(p, step_binding, {"request":provider_request}, "inference", self._provider_caps)
                    fresh()
                    try: raw = self._provider["invoke"](copy(provider_request), {"deadline":options["deadline"], "cancelled":options["cancelled"]})
                    except Exception:
                        self._check(options, expires)
                        raise LoopError("PROVIDER_FAILED") from None
                    self._check(options, expires)
                    candidate = copy(raw, "INVALID_RESPONSE")
                    if type(candidate) is not dict: raise LoopError("INVALID_RESPONSE")
                    if candidate.get("type") == "tool":
                        if set(candidate) != {"type", "name", "arguments"} or type(candidate["name"]) is not str or type(candidate["arguments"]) is not dict: raise LoopError("INVALID_RESPONSE")
                        if not any(t["name"] == candidate["name"] for t in tools): raise LoopError("TOOL_NOT_ALLOWED")
                        if step == options["maxSteps"]: raise LoopError("STEP_LIMIT")
                        fresh()
                        return {"candidate":candidate}
                    if candidate.get("type") != "final" or set(candidate) != {"type", "text"} or type(candidate["text"]) is not str: raise LoopError("INVALID_RESPONSE")
                    data = copy({"request":provider_request, "candidate":candidate})
                    context = self._decide(p, step_binding, data, "release", caps(authority["releaseSources"], authority["releaseComplete"]))
                    if callback(lambda:self._host.authorize_final(copy(p), copy(context), copy(data))) is not True: raise LoopError("COMPLETION_DENIED")
                    fresh()
                    return {"output":{"text":candidate["text"], "provenance":{"profile":LLM_LOOP_PROFILE, "providerId":self._provider["id"],
                            "providerRevision":self._provider["revision"], "outputDigest":binding_digest({"text":candidate["text"]}), "trustLevel":5, "steps":step}}}
                result = self._coordinator.run(actor, infer)
                if "output" in result: return result["output"]
                candidate = result["candidate"]
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
                messages.extend([{"role":"assistant", "call":{"name":candidate["name"], "arguments":candidate["arguments"]}}, {"role":"tool", "name":candidate["name"], "data":output["data"]}])
                copy({"messages":messages, "tools":tools})
            raise LoopError("STEP_LIMIT")
        except LoopError: raise
        except DispatchError as exc: raise LoopError(exc.code) from None
        except ServiceError as exc: raise LoopError(exc.code if exc.code in ("UNAUTHENTICATED", "FORBIDDEN") else "HOST_ERROR") from None
        except StoreError as exc: raise LoopError(exc.code if exc.code in ("NOT_FOUND", "EXPIRED", "STATE_BUSY") else "HOST_ERROR") from None
        except Exception: raise LoopError("HOST_ERROR") from None
