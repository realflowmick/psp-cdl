# SPDX-License-Identifier: Apache-2.0
"""Opt-in durable turns and explicit historical recovery; no automatic replay."""
from datetime import datetime, timezone
from types import SimpleNamespace
from psp_cdl_core import canonical_json
from psp_cdl_cdl import aggregate_capabilities, evaluate_batch
from psp_cdl_api_server.service import ServiceError, identifier
from psp_cdl_api_server.persistence import StoreError, integer
from psp_cdl_mcpproxy import binding_digest
from .loop import BufferedLlmLoop, LoopError, copy

DURABLE_LOOP_PROFILE = "PSP-LLM-DURABLE-0.1"


class LockdownError(LoopError):
    def __init__(self, response):
        super().__init__("PSP_POST_COMPLETION_LOCKDOWN")
        self.response = response


def call(fn, code="HOST_ERROR"):
    try: return fn()
    except Exception: raise LoopError(code) from None


def same(a, b): return canonical_json(a) == canonical_json(b)
def actor(p): return {k:p[k] for k in ("tenantId", "subjectId")}


class DurableLlmLoop(BufferedLlmLoop):
    _completion_policy = "lockdown"
    def _prepare_commit(self,p,binding,command,options): return command
    def _authorize_commit(self,p,binding,context,options):
        if call(lambda:self._host.authorize_transition(copy(p),copy(context))) is not True: raise LoopError("TRANSITION_DENIED")
    def _make_buffered(self,host,on_prompt,token,session,options): return BufferedLlmLoop(self._store,self._gate,host,self._provider)
    def _turn_command(self,command,buffered): return command
    def __init__(self, store, gate, host, provider, configuration=None):
        super().__init__(store, gate, host, provider)
        if not store.durable_turns or any(not callable(getattr(host, k, None)) for k in ("plan_turn", "authorize_transition", "audit", "authorize_recovery", "recovery_policy")):
            raise LoopError("INVALID_CONFIGURATION")
        if type(configuration) is not dict or set(configuration) != {"postCompletion"} or configuration["postCompletion"] != "lockdown":
            raise LoopError("UNSUPPORTED_POST_COMPLETION")

    def _identity(self, token, scope, expected=None):
        p = self._auth.authenticate(token)
        if scope not in p["scopes"] or expected and any(p[k] != expected[k] for k in ("tenantId", "subjectId")): raise LoopError("FORBIDDEN")
        if scope == "sessions:write" and "models:invoke" not in p["scopes"]: raise LoopError("FORBIDDEN")
        return p

    @staticmethod
    def _boundary(fn):
        try: return fn()
        except LoopError: raise
        except ServiceError as exc: raise LoopError(exc.code if exc.code in ("UNAUTHENTICATED", "FORBIDDEN") else "HOST_ERROR") from None
        except StoreError as exc:
            raise LoopError(exc.code if exc.code in ("NOT_FOUND", "EXPIRED", "STATE_BUSY", "STATE_CONFLICT", "IDEMPOTENCY_CONFLICT", "PERSISTENCE_DENIED", "AUTHORIZATION_DENIED", "INVALID_STATE", "INVALID_TRANSITION", "STORE_BUSY") else "HOST_ERROR") from None
        except Exception: raise LoopError("HOST_ERROR") from None

    @staticmethod
    def _controls(options):
        if type(options) is not dict or not integer(options.get("deadline")) or not callable(options.get("cancelled")): raise LoopError("INVALID_REQUEST")
        return {k:options[k] for k in ("deadline", "cancelled")}

    @staticmethod
    def _present(receipt, recovered):
        return {**copy(receipt["output"]), "receipt":{"profile":DURABLE_LOOP_PROFILE, "requestId":receipt["requestId"], "sessionVersion":receipt["sessionVersion"], "status":receipt["status"], "recovered":recovered}}

    def run(self, token, session_id, request, options):
        return self._boundary(lambda:self._run_turn(token, session_id, request, options))

    def _run_turn(self, token, session_id, request, options):
        value, controls = copy(request), self._controls(options)
        if type(value) is not dict or set(value) != {"message"} or type(value["message"]) is not str or not identifier(session_id) or not identifier(options.get("requestId")) or not integer(options.get("expectedVersion")) or options["expectedVersion"] < 1 or not integer(options.get("maxSteps")) or not 1 <= options["maxSteps"] <= 32:
            raise LoopError("INVALID_REQUEST")
        options = {**controls, **{k:options[k] for k in ("maxSteps", "requestId", "expectedVersion")}}
        p = self._identity(token, "sessions:write")
        owner, input_digest = actor(p), binding_digest(value)
        self._check(controls)
        def preflight():
            session = self._store.execute(owner, {"action":"getSession", "sessionId":session_id})
            completion = session.get("llmCompletion")
            if session["status"] == "completed" and type(completion) is dict and completion.get("profile") == DURABLE_LOOP_PROFILE and completion.get("policy") == "lockdown":
                locked_at = completion.get("lockedAt")
                if not integer(locked_at) or locked_at > 253402300799: raise LoopError("INVALID_STATE")
                if call(lambda:self._host.audit(copy(p), {"signal":"post_completion_override_attempt", "sessionId":session_id, "inputDigest":input_digest, "at":self._host.now()}), "AUDIT_FAILED") is not True: raise LoopError("AUDIT_FAILED")
                stamp = datetime.fromtimestamp(locked_at, timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
                raise LockdownError({"error":"session_locked", "code":"PSP_POST_COMPLETION_LOCKDOWN", "message":"This session has concluded. No further interaction is permitted.", "session_id":session_id, "locked_at":stamp, "policy":"lockdown"})
            if session["status"] != "running": raise LoopError("INACTIVE_SESSION")
            old = None
            try: old = self._store.execute(owner, {"action":"getTurn", "sessionId":session_id, "requestId":options["requestId"]})
            except StoreError as exc:
                if exc.code != "NOT_FOUND": raise
            if old is not None:
                raise LoopError("TURN_ALREADY_COMMITTED" if old["inputDigest"] == input_digest and old["sessionVersion"] == options["expectedVersion"]+1 else "IDEMPOTENCY_CONFLICT")
            if session["version"] != options["expectedVersion"]: raise LoopError("STALE_SESSION")
            return session
        session = self._coordinator.run(owner, preflight)
        authority = self._snapshot(p, session)
        expires = min(authority["expires"], session["expiresAt"])
        self._check(controls, expires)
        captured, plan_error = {}, []
        def snapshot(live, current):
            try:
                if not same(current, session): raise LoopError("STALE_SESSION")
                a = self._host.snapshot(live, current)
                if not same(a, authority): raise LoopError("STALE_AUTHORITY")
                return a
            except Exception as exc:
                plan_error.append(exc)
                raise
        def prompt(live, binding):
            captured["prompt"] = copy(self._host.prompt(live, binding), "PROMPT_REJECTED")
            return captured["prompt"]
        def authorize_final(live, binding, data):
            try:
                if call(lambda:self._host.authorize_final(copy(live), copy(binding), copy(data))) is not True: return False
                plan = copy(call(lambda:self._host.plan_turn(copy(live), copy({**binding, "requestId":options["requestId"], "postCompletion":self._completion_policy}), copy(data))), "INVALID_PLAN")
                if type(plan) is not dict or set(plan) != {"state", "retained", "complete"} or type(plan["state"]) is not dict or type(plan["retained"]) is not dict or type(plan["complete"]) is not bool: raise LoopError("INVALID_PLAN")
                captured.update(plan=plan, binding=copy(binding), data=copy(data))
                return True
            except Exception as exc:
                plan_error.append(exc)
                return False
        wrapped = SimpleNamespace(authenticate=self._host.authenticate, now=self._host.now, snapshot=snapshot, prompt=prompt,
                                  verification=self._host.verification, policy=self._host.policy, authorize_final=authorize_final)
        buffered=self._make_buffered(wrapped,lambda prompt:captured.update(prompt=copy(prompt)),token,session,options)
        try: output = buffered.run(token, session_id, value, options)
        except Exception:
            if plan_error: raise plan_error[-1]
            raise
        if set(captured) != {"prompt", "plan", "binding", "data"}: raise LoopError("INVALID_PLAN")
        plan, binding, data, signed_prompt = (captured[k] for k in ("plan", "binding", "data", "prompt"))
        def fresh(committed_version=None):
            self._check(controls, expires)
            live = self._identity(token, "sessions:write", p)
            current = self._store.execute(owner, {"action":"getSession", "sessionId":session_id})
            if (not same(current, session)) if committed_version is None else current["version"] != committed_version: raise LoopError("STALE_SESSION")
            if not same(self._snapshot(live, current), authority): raise LoopError("STALE_AUTHORITY")
            self._verify(live, binding, signed_prompt)
            self._check(controls, expires)
        guard_error = []
        def guard(context):
            try:
                if context["replay"]: raise LoopError("TURN_ALREADY_COMMITTED")
                fresh()
                self._authorize_commit(p,binding,context,options)
                fresh()
                return True
            except Exception as exc:
                guard_error.append(exc)
                return False
        command = {"action":"commitTurn", "requestId":options["requestId"], "sessionId":session_id, "expectedVersion":options["expectedVersion"],
                   **{k:session[k] for k in ("nodeId", "nodeVersion", "policyVersion")}, **plan, "postCompletion":self._completion_policy, "inputDigest":input_digest, "output":output}
        command=self._prepare_commit(p,binding,self._turn_command(command,buffered),options)
        try: receipt = self._store.execute(owner, command, guard)
        except Exception:
            if guard_error: raise guard_error[0]
            raise
        def release():
            fresh(receipt["sessionVersion"])
            self._decide(p, {**binding, "committedVersion":receipt["sessionVersion"]}, data, "release", aggregate_capabilities(authority["releaseSources"], authority["releaseComplete"]))
            fresh(receipt["sessionVersion"])
            return self._present(receipt, False)
        return self._coordinator.run(owner, release)

    def recover(self, token, session_id, request_id, options):
        return self._boundary(lambda:self._recover(token, session_id, request_id, options))

    def _recover(self, token, session_id, request_id, options):
        controls = self._controls(options)
        if not identifier(session_id) or not identifier(request_id): raise LoopError("INVALID_REQUEST")
        p = self._identity(token, "sessions:read")
        owner = actor(p)
        self._check(controls)
        def release():
            session = self._store.execute(owner, {"action":"getSession", "sessionId":session_id})
            receipt = self._store.execute(owner, {"action":"getTurn", "sessionId":session_id, "requestId":request_id})
            authority = self._snapshot(p, session)
            expires = min(authority["expires"], session["expiresAt"])
            self._check(controls, expires)
            context = {**owner, "sessionId":session_id, "sessionVersion":session["version"], "epoch":self._store.epoch, "policyVersion":authority["policyVersion"],
                       "authorityRevision":authority["revision"], "phase":"recovery", "requestId":request_id, "receiptDigest":binding_digest(receipt), "deadline":controls["deadline"]}
            def fresh():
                live = self._identity(token, "sessions:read", p)
                if not same(self._store.execute(owner, {"action":"getSession", "sessionId":session_id}), session): raise LoopError("STALE_SESSION")
                if not same(self._snapshot(live, session), authority): raise LoopError("STALE_AUTHORITY")
                self._check(controls, expires)
            if call(lambda:self._host.authorize_recovery(copy(p), copy(context), copy(receipt))) is not True: raise LoopError("RECOVERY_DENIED")
            policy = copy(call(lambda:self._host.recovery_policy(copy(p), copy(context), copy(receipt))), "INVALID_POLICY")
            if type(policy) is not dict or set(policy) != {"bindingDigest", "resources"} or policy["bindingDigest"] != binding_digest(context) or type(policy["resources"]) is not list or not policy["resources"]: raise LoopError("INVALID_POLICY")
            capabilities = aggregate_capabilities(authority["releaseSources"], authority["releaseComplete"])
            resources = []
            for resource in policy["resources"]:
                if type(resource) is not dict: raise LoopError("INVALID_POLICY")
                resources.append({**resource, "capabilities":aggregate_capabilities([{"id":"recipient", "capabilities":capabilities}, {"id":"path", "capabilities":resource.get("capabilities")}], True)})
            decision = evaluate_batch(resources)["decision"]
            if decision == "unsupported": raise LoopError("UNSUPPORTED_POLICY")
            if decision != "allow": raise LoopError("OUTPUT_DENIED")
            fresh()
            return self._present(receipt, True)
        return self._coordinator.run(owner, release)
