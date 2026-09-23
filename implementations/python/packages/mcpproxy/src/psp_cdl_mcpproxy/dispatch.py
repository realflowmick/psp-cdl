# SPDX-License-Identifier: Apache-2.0
"""Host-embedded dispatch gate. No network listener or durable effect permits."""
import hashlib
import re
from threading import Lock
from psp_cdl_core import canonical_json
from psp_cdl_cdl import aggregate_capabilities, evaluate_batch
from psp_cdl_api_server.service import SecurityService, ServiceError, identifier
from psp_cdl_api_server.persistence import OwnerCoordinator, StoreError, bounded, integer
from .schema import check_schema, matches

DISPATCH_PROFILE = "PSP-MCP-DISPATCH-0.1"


class DispatchError(ValueError):
    def __init__(self, code):
        super().__init__(code)
        self.code = code


def binding_digest(value):
    return hashlib.sha256(canonical_json(value).encode("utf-8")).hexdigest()


def copy(value, code="INVALID_REQUEST"):
    try: return bounded(value)
    except Exception: raise DispatchError(code) from None


def callback(work, code="HOST_ERROR"):
    try: return work()
    except Exception: raise DispatchError(code) from None


def capabilities(sources, complete):
    try: return aggregate_capabilities(sources, complete)
    except Exception: raise DispatchError("INVALID_CAPABILITIES") from None


def affinity(node):
    definition = node.get("definition")
    if type(definition) is not dict: raise DispatchError("UNSUPPORTED_AFFINITY")
    value = definition.get("agents", "")
    if type(value) is not str: raise DispatchError("UNSUPPORTED_AFFINITY")
    uris = [] if value == "" else [v.strip(" \t\r\n") for v in value.split(",")]
    if len(uris) > 1024 or any(not re.fullmatch(r"mcp://[A-Za-z0-9_-]{1,64}/[A-Za-z0-9_-]{1,64}", u) for u in uris): raise DispatchError("UNSUPPORTED_AFFINITY")
    return set(uris)


class McpDispatchGate:
    """Only an authenticated host may construct the registry and select the session."""
    def authenticate(self, token): return self._auth.authenticate(token)
    def __init__(self, store, host, registry_revision, registrations):
        if not isinstance(store.coordinator, OwnerCoordinator) or not identifier(registry_revision) or type(registrations) is not list or len(registrations) > 1024 or any(not callable(getattr(host, name, None)) for name in ("authenticate", "now", "snapshot", "policy")):
            raise DispatchError("INVALID_CONFIGURATION")
        self._store, self._host, self._revision = store, host, registry_revision
        self._coordinator, self._auth, self._tools = store.coordinator, SecurityService(host), {}
        self._registry_lock, self._active, self._used_revisions = Lock(), 0, {registry_revision}
        self._tools = self._prepare(registrations)

    @property
    def registry_revision(self):
        with self._registry_lock: return self._revision

    def uses_store(self, store):
        return store is self._store

    @staticmethod
    def _prepare(registrations):
        if type(registrations) is not list or len(registrations)>1024: raise DispatchError("INVALID_CONFIGURATION")
        tools={}
        for r in registrations:
            if type(r) is not dict: raise DispatchError("INVALID_CONFIGURATION")
            invoke = r.get("invoke")
            meta = copy({k:v for k,v in r.items() if k != "invoke"}, "INVALID_CONFIGURATION")
            if set(meta) != {"server", "name", "revision", "readOnly", "sources", "complete", "inputSchema", "outputSchema"} or any(type(meta[k]) is not str or not re.fullmatch(r"[A-Za-z0-9_-]{1,64}", meta[k]) for k in ("server", "name")) or not identifier(meta["revision"]) or type(meta["readOnly"]) is not bool or not callable(invoke):
                raise DispatchError("INVALID_CONFIGURATION")
            try:
                check_schema(meta["inputSchema"])
                check_schema(meta["outputSchema"])
            except Exception: raise DispatchError("UNSUPPORTED_SCHEMA") from None
            if meta["inputSchema"]["type"] != "object" or meta["outputSchema"]["type"] != "object": raise DispatchError("UNSUPPORTED_SCHEMA")
            name = meta["server"] + "." + meta["name"]
            if name in tools: raise DispatchError("INVALID_CONFIGURATION")
            tools[name] = {"meta":meta, "invoke":invoke, "caps":capabilities(meta["sources"], meta["complete"]), "name":name, "uri":"mcp://"+meta["server"]+"/"+meta["name"]}
        return tools

    def replace_registry(self, expected_revision, next_revision, registrations):
        """Host-only compare-and-replace; matching authority is published separately."""
        with self._registry_lock:
            if expected_revision!=self._revision: raise DispatchError("REVISION_CONFLICT")
            if self._active: raise DispatchError("REGISTRY_BUSY")
            if not identifier(next_revision) or next_revision in self._used_revisions: raise DispatchError("INVALID_REGISTRY_REVISION")
            if len(self._used_revisions)>=4096: raise DispatchError("REVISION_EXHAUSTED")
            tools=self._prepare(registrations)
            self._tools,self._revision=tools,next_revision
            self._used_revisions.add(next_revision)

    def _check(self, options, expires=9007199254740991):
        if type(options) is not dict or not integer(options.get("deadline")) or not callable(options.get("cancelled")): raise DispatchError("INVALID_REQUEST")
        now, cancelled = self._host.now(), options["cancelled"]()
        if not integer(now) or type(cancelled) is not bool: raise DispatchError("HOST_ERROR")
        if cancelled: raise DispatchError("CANCELLED")
        if now >= options["deadline"]: raise DispatchError("DEADLINE_EXCEEDED")
        if now >= expires: raise DispatchError("STALE_AUTHORITY")

    def _principal(self, token, scope, expected=None):
        p = self._auth.authenticate(token)
        if scope not in p["scopes"] or expected and any(p[k] != expected[k] for k in ("tenantId", "subjectId")): raise DispatchError("FORBIDDEN")
        return p

    def _snapshot(self, p, session):
        s = copy(callback(lambda:self._host.snapshot(copy(p), copy(session))), "INVALID_AUTHORITY")
        if type(s) is not dict or set(s) != {"revision", "policyVersion", "registryRevision", "expires", "releaseSources", "releaseComplete"} or not identifier(s["revision"]) or s["policyVersion"] != session["policyVersion"] or s["registryRevision"] != self._revision or not integer(s["expires"]): raise DispatchError("STALE_AUTHORITY")
        capabilities(s["releaseSources"], s["releaseComplete"])
        return s

    def _within(self, token, session_id, scope, options, work, expected=None):
        with self._registry_lock: self._active+=1
        try:
            p = self._principal(token, scope, expected)
            actor = {k:p[k] for k in ("tenantId", "subjectId")}
            self._check(options)
            def locked():
                session = self._store.execute(actor, {"action":"getSession", "sessionId":session_id})
                if session["status"] != "running": raise DispatchError("INACTIVE_SESSION")
                node = self._store.execute(actor, {"action":"getNode", "nodeId":session["nodeId"], "nodeVersion":session["nodeVersion"]})
                authority = self._snapshot(p, session)
                expires = min(authority["expires"], session["expiresAt"])
                self._check(options, expires)
                def fresh():
                    self._principal(token, scope, p)
                    if canonical_json(self._snapshot(p, session)) != canonical_json(authority): raise DispatchError("STALE_AUTHORITY")
                    if canonical_json(self._store.execute(actor, {"action":"getSession", "sessionId":session_id})) != canonical_json(session): raise DispatchError("STALE_SESSION")
                    self._check(options, expires)
                return work(p, session, authority, affinity(node), fresh)
            return self._coordinator.run(actor, locked)
        except DispatchError: raise
        except ServiceError as exc:
            raise DispatchError(exc.code if exc.code in ("UNAUTHENTICATED", "FORBIDDEN") else "HOST_ERROR") from None
        except StoreError as exc:
            raise DispatchError(exc.code if exc.code in ("NOT_FOUND", "EXPIRED", "STATE_BUSY") else "HOST_ERROR") from None
        except Exception: raise DispatchError("HOST_ERROR") from None
        finally:
            with self._registry_lock: self._active-=1

    def list_tools(self, token, session_id, options, expected=None):
        options = dict(options) if type(options) is dict else {}
        def work(p, session, authority, allowed, fresh):
            result = [{"name":t["name"], "inputSchema":copy(t["meta"]["inputSchema"]), "outputSchema":copy(t["meta"]["outputSchema"])} for _, t in sorted(self._tools.items()) if t["meta"]["readOnly"] and t["uri"] in allowed]
            fresh()
            return copy(result, "INVALID_OUTPUT")
        return self._within(token, session_id, "tools:list", options, work, expected)

    def call_tool(self, token, session_id, request, options, expected=None):
        options = dict(options) if type(options) is dict else {}
        if "authorizeDispatch" in options and not callable(options["authorizeDispatch"]): raise DispatchError("INVALID_REQUEST")
        def work(p, session, authority, allowed, fresh):
            r = copy(request)
            if type(r) is not dict or set(r) != {"name", "arguments"} or type(r["name"]) is not str or type(r["arguments"]) is not dict: raise DispatchError("INVALID_REQUEST")
            tool = self._tools.get(r["name"])
            if tool is None or tool["uri"] not in allowed: raise DispatchError("TOOL_NOT_ALLOWED")
            if not tool["meta"]["readOnly"]: raise DispatchError("UNSUPPORTED_TOOL_MODE")
            if not matches(tool["meta"]["inputSchema"], r["arguments"]): raise DispatchError("INVALID_ARGUMENTS")
            binding = {"tenantId":p["tenantId"], "subjectId":p["subjectId"], "sessionId":session_id, "sessionVersion":session["version"], "nodeId":session["nodeId"], "nodeVersion":session["nodeVersion"], "epoch":self._store.epoch, "policyVersion":authority["policyVersion"], "authorityRevision":authority["revision"], "registryRevision":self._revision, "toolUri":tool["uri"], "toolRevision":tool["meta"]["revision"], "inputDigest":binding_digest(r["arguments"]), "deadline":options["deadline"]}
            def decide(phase, data, bound, caps):
                context = {**bound, "phase":phase}
                policy = copy(callback(lambda:self._host.policy(copy(p), copy(context), copy(data), phase)), "INVALID_POLICY")
                if type(policy) is not dict or policy.get("bindingDigest") != binding_digest(context) or type(policy.get("resources")) is not list or not policy["resources"]: raise DispatchError("INVALID_POLICY")
                inputs = [{**v, "capabilities":capabilities([{"id":"registry", "capabilities":caps}, {"id":"resource", "capabilities":v.get("capabilities")}], True)} for v in policy["resources"]]
                decision = evaluate_batch(inputs)["decision"]
                if decision == "unsupported": raise DispatchError("UNSUPPORTED_POLICY")
                if decision != "allow": raise DispatchError("POLICY_DENIED" if phase == "dispatch" else "OUTPUT_DENIED")
            decide("dispatch", r["arguments"], binding, tool["caps"])
            if "authorizeDispatch" in options and callback(lambda:options["authorizeDispatch"](copy(session), list(tool["caps"]))) is not True:
                raise DispatchError("HOST_DENIED")
            fresh()
            self._check(options, min(authority["expires"], session["expiresAt"]))
            try: raw = tool["invoke"](copy(r["arguments"]), {"deadline":options["deadline"], "cancelled":options["cancelled"]})
            except Exception:
                self._check(options, min(authority["expires"], session["expiresAt"]))
                raise DispatchError("TOOL_FAILED") from None
            output = copy(raw, "INVALID_OUTPUT")
            self._check(options, min(authority["expires"], session["expiresAt"]))
            if not matches(tool["meta"]["outputSchema"], output): raise DispatchError("INVALID_OUTPUT")
            output_digest = binding_digest(output)
            decide("release", output, {**binding, "outputDigest":output_digest}, capabilities(authority["releaseSources"], authority["releaseComplete"]))
            fresh()
            return {"data":output, "provenance":{"profile":DISPATCH_PROFILE, "toolUri":tool["uri"], "toolRevision":tool["meta"]["revision"], "registryRevision":self._revision, "inputDigest":binding["inputDigest"], "outputDigest":output_digest, "trustLevel":5}}
        return self._within(token, session_id, "tools:call", options, work, expected)
