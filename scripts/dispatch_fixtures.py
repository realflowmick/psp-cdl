# SPDX-License-Identifier: Apache-2.0
"""Public synthetic fixtures; never use these credentials for real data."""
import json
import tempfile
from pathlib import Path
from copy import deepcopy
from psp_cdl_api_server.persistence import WorkflowStore, OwnerCoordinator, StoreError
from psp_cdl_api_server.sqlite import SqliteBackend
from psp_cdl_mcpproxy import McpDispatchGate, binding_digest

SUITE = json.loads((Path(__file__).resolve().parents[1]/"conformance/vectors/dispatch/gate-0.1.json").read_text(encoding="utf-8"))


class Fixture:
    def __init__(self, settings=None):
        self.flags = {"now":1000, **(settings or {})}
        self.actor = {"tenantId":"tenant-a", "subjectId":"subject-a"}
        self.principal = {**self.actor, "scopes":["tools:list", "tools:call"]}
        self.calls = self.busy = 0
        self.directory = tempfile.TemporaryDirectory(prefix="psp-dispatch-")
        self.backend = SqliteBackend(str(Path(self.directory.name)/"state.sqlite"), "epoch-1", lambda:self.flags["now"])
        self.coordinator = OwnerCoordinator()
        self.store = WorkflowStore(self.backend, resume_secret=bytes([7])*32, authorize_persistence=lambda *_:not self.flags.get("denyPersistence"), coordinator=self.coordinator, durable_turns=bool(self.flags.get("durableTurns")))
        try:
            self.store.execute(self.actor, {"action":"putNode", "nodeId":"entry", "nodeVersion":"1", "definition":{"agents":self.flags.get("agents", "mcp://echo/read,mcp://other/read")}})
            self.session = self.store.execute(self.actor, {"action":"createSession", "requestId":"seed", "nodeId":"entry", "nodeVersion":"1", "policyVersion":"policy-1", "expiresAt":2000, "state":{"stage":"initial"}})
            if self.flags.get("inactive"):
                self.store.execute(self.actor, {"action":"updateSession", "requestId":"finish", "sessionId":self.session["sessionId"], "expectedVersion":1, "nodeId":"entry", "nodeVersion":"1", "policyVersion":"policy-1", "status":"completed", "state":{}})
            f = self.flags
            schema = deepcopy(SUITE["schema"])
            if f.get("unsupportedSchema"): schema["properties"]["message"]["pattern"] = ".*"
            registration = {"server":"echo", "name":"read", "revision":"tool-1", "readOnly":not f.get("mutating"), "complete":not f.get("incomplete"), "sources":[{"id":"server", "capabilities":["used-for-model-training"] if f.get("serverTraining") else ["logs-operations"]}, {"id":"tool", "capabilities":[]}, {"id":"transitive", "capabilities":["used-for-model-training"] if f.get("transitiveTraining") else []}], "inputSchema":schema, "outputSchema":SUITE["schema"], "invoke":self.invoke}
            def other(*_):
                self.calls += 1
                return {"message":"other"}
            registrations = [registration, registration] if f.get("duplicate") else [registration, {**registration, "server":"other", "invoke":other}]
            self.gate = McpDispatchGate(self.store, self, "registry-1", registrations)
            self.options = {"deadline":1800, "cancelled":lambda:bool(self.flags.get("cancelled"))}
        except Exception:
            self.close()
            raise

    def now(self): return self.flags["now"]
    def authenticate(self, token):
        if self.flags.get("revoked"): return None
        if token == "test-owner": return {**self.principal, "scopes":[] if self.flags.get("noScope") else self.principal["scopes"]}
        if token == "test-other": return {**self.principal, "subjectId":"other"}
        if token == "test-tenant": return {**self.principal, "tenantId":"other"}
        return None
    def snapshot(self, *_):
        f = self.flags
        return {"revision":"authority-2" if f.get("drift") else "authority-1", "policyVersion":"policy-2" if f.get("wrongPolicy") else "policy-1", "registryRevision":"registry-2" if f.get("registryDrift") else "registry-1", "expires":999 if f.get("expired") else 1900, "releaseSources":[{"id":"model-recipient", "capabilities":["used-for-model-training"] if f.get("outputDeny") else []}], "releaseComplete":not f.get("incompleteRelease")}
    def policy(self, p, binding, data, phase):
        f = self.flags
        if f.get("throwPolicy"): raise RuntimeError("PRIVATE_POLICY_DETAIL")
        if f.get("race") and phase == "dispatch":
            try: self.update()
            except StoreError as exc:
                if exc.code != "STATE_BUSY": raise
                self.busy += 1
        for before, after, flag in (("driftBefore", "driftAfter", "drift"), ("revokeBefore", "revokeAfter", "revoked"), ("cancelBefore", "cancelAfter", "cancelled")):
            if (f.get(before) and phase == "dispatch") or (f.get(after) and phase == "release"): f[flag] = True
        if f.get("timeoutBefore") and phase == "dispatch": f["now"] = 1800
        if f.get("registryBefore") and phase == "dispatch": f["registryDrift"] = True
        digest = binding_digest(binding)
        if f.get("mutateHost"):
            binding["inputDigest"], data["message"], p["subjectId"] = "forged", "forged", "other"
        return {"bindingDigest":"wrong" if f.get("wrongBinding") else digest, "resources":[] if f.get("emptyPolicy") else [{"classes":[], "covenants":["unknown-covenant"] if f.get("unsupportedPolicy") else ["no-training"], "capabilities":["used-for-model-training"] if f.get("policyDeny") else [], "checks":{}, "parameters":{}, "context":{}}]}
    def invoke(self, args, _):
        self.calls += 1
        f = self.flags
        if f.get("onInvoke"): f["onInvoke"]()
        if f.get("throwTool"): raise RuntimeError("PRIVATE_TOOL_DETAIL")
        if f.get("toolTimeout"): f["now"] = 1800
        if f.get("toolCancel"): f["cancelled"] = True
        if f.get("mutateArguments"): args["message"] = "changed"
        if f.get("badOutput"): return {"message":42}
        if f.get("forgedProvenance"): return {"message":args["message"], "trustLevel":1}
        if f.get("hugeOutput"): return {"message":"x"*1_048_577}
        return {"message":args["message"]}
    def update(self):
        return self.store.execute(self.actor, {"action":"updateSession", "requestId":"transition", "sessionId":self.session["sessionId"], "expectedVersion":1, "nodeId":"entry", "nodeVersion":"1", "policyVersion":"policy-1", "status":"running", "state":{"stage":"changed"}})
    def close(self):
        self.backend.close()
        self.directory.cleanup()


def run_case(case):
    f = None
    try:
        f = Fixture(case.get("settings"))
        token = case.get("settings", {}).get("token", "test-owner")
        result = f.gate.list_tools(token, f.session["sessionId"], f.options) if case.get("list") else f.gate.call_tool(token, f.session["sessionId"], case.get("request", {"name":"echo.read", "arguments":{"message":"hello 🧪"}}), f.options)
        return {"code":"OK", "calls":f.calls, "busy":f.busy, "released":1, "result":result}
    except Exception as exc:
        return {"code":getattr(exc, "code", "UNEXPECTED_ERROR"), "calls":f.calls if f else 0, "busy":f.busy if f else 0, "released":0}
    finally:
        if f: f.close()
