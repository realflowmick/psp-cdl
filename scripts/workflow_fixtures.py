# SPDX-License-Identifier: Apache-2.0
"""Synthetic test/example host. Never use its public credentials for real data."""
import json
import tempfile
from pathlib import Path
from copy import deepcopy
from psp_cdl_api_server.persistence import WorkflowStore
from psp_cdl_api_server.sqlite import SqliteBackend
from psp_cdl_api_server.workflow import WorkflowService
from psp_cdl_api_server.operations import SessionOperations
from psp_cdl_api_server.http import handle_http
from service_fixtures import SUITE as SECURITY_SUITE

SUITE = json.loads((Path(__file__).resolve().parents[1]/"conformance/vectors/workflows/service-0.1.json").read_text(encoding="utf-8"))
ROUTES = {"createSession":"/v1/sessions/create", "getSession":"/v1/sessions/get", "updateSession":"/v1/sessions/update", "getNode":"/v1/nodes/fetch", "createCheckpoint":"/v1/checkpoints/create", "resumeCheckpoint":"/v1/checkpoints/resume", "evaluate":"/v1/policy/evaluate"}
SCOPES = ["sessions:write", "sessions:read", "nodes:read", "checkpoints:write", "checkpoints:resume", "policy:evaluate", "security:verify"]


class Fixture:
    def __init__(self):
        self.directory = tempfile.TemporaryDirectory(prefix="psp-workflow-")
        self.flags = {"now":1000, "policy":"policy-1", "persist":True, "allowResume":True}
        self.tokens = {}
        self.actor = {"tenantId":"tenant-a", "subjectId":"subject-a"}
        self.principal = {**self.actor, "scopes":SCOPES}
        self.backend = SqliteBackend(str(Path(self.directory.name)/"state.sqlite"), "epoch-1", clock=lambda:self.flags["now"])
        self.store = WorkflowStore(self.backend, resume_secret=bytes([7])*32, authorize_persistence=lambda a,w:self.flags["persist"])
        for node_id in ("entry", "next"):
            self.store.execute(self.actor, {"action":"putNode", "nodeId":node_id, "nodeVersion":"1", "definition":{"stage":node_id, "hidden":"PRIVATE_STATE"}})
        seed = self.store.execute(self.actor, {"action":"createSession", "requestId":"seed", "nodeId":"entry", "nodeVersion":"1", "policyVersion":"policy-1", "expiresAt":2000, "state":{"stage":"initial", "hidden":"PRIVATE_STATE"}})
        self.refs = {"@session":seed["sessionId"]}
        self.operations = SessionOperations(self.store, self)
        self.service = WorkflowService(self.store, self)

    def now(self): return self.flags["now"]
    def authenticate(self, token):
        if self.flags.get("revoked"): return None
        if token == "test-owner": return self.principal
        if token == "test-reader": return {**self.principal, "scopes":["sessions:read", "nodes:read"]}
        if token == "test-other": return {**self.principal, "subjectId":"other"}
        if token == "test-tenant": return {**self.principal, "tenantId":"other"}
        return None
    def policy_version(self, principal): return self.flags["policy"]
    def authorize(self, principal, context):
        f = self.flags
        if f.get("throwAuthorize"): raise RuntimeError("PRIVATE_BACKEND_DETAIL")
        if f.get("revokeOnAuthorize"): f["revoked"] = True
        if f.get("changePolicyOnAuthorize"): f["policy"] = "policy-2"
        if f.get("raceOnAuthorize") and context["current"] and context["command"]["action"] == "updateSession":
            f["raceOnAuthorize"] = False
            self.store.execute(self.actor, {"action":"updateSession", "requestId":"racer", "sessionId":self.refs["@session"], "expectedVersion":context["current"]["version"], "nodeId":"entry", "nodeVersion":"1", "policyVersion":"policy-1", "status":"running", "state":{"stage":"racer"}})
        if f.get("mutateGuard"):
            context["command"]["state"] = {"stage":"tampered"}
            context["result"]["state"] = {"stage":"tampered"}
            if context["current"]: context["current"]["version"] = 99
        if f.get("truthy"): return "yes"
        return not f.get("deny") and not (f.get("denyReplay") and context["replay"]) and not (context["command"]["action"] == "resumeCheckpoint" and not f["allowResume"])
    def present(self, principal, operation, data): return {"stage":data.get("stage", "empty")}
    def deliver_checkpoint(self, principal, checkpoint):
        if self.flags.get("deliverFail"): raise RuntimeError("PRIVATE_BACKEND_DETAIL")
        self.tokens[(principal["tenantId"], principal["subjectId"], checkpoint["checkpointId"])] = checkpoint["resumeToken"]
    def resume_token(self, principal, checkpoint_id): return self.tokens.get((principal["tenantId"], principal["subjectId"], checkpoint_id))
    def snapshot(self, principal, session, operation_id):
        return {"expires":1900, "verification":{"keys":[], "context":{}, "allowedAttributes":[]}, "resources":[{**deepcopy(SECURITY_SUITE["snapshot"]["resources"][0]), "capabilities":[]}]}
    def resolve(self, principal, operation_id): return self.operations.resolve(principal, operation_id)
    def replace(self, value):
        if type(value) is str: return self.refs.get(value, value)
        if type(value) is list: return [self.replace(v) for v in value]
        if type(value) is dict: return {k:self.replace(v) for k,v in value.items()}
        return value
    def normalize(self, value):
        if type(value) is str: return next((k for k,v in self.refs.items() if v == value), value)
        if type(value) is list: return [self.normalize(v) for v in value]
        if type(value) is dict: return {k:self.normalize(v) for k,v in value.items()}
        return value
    def capture(self, step, body):
        if "capture" in step: self.refs[step["capture"]] = body["result"]["checkpointId" if step["operation"] == "createCheckpoint" else "sessionId"]
    def request(self, step):
        return {"method":"POST", "path":ROUTES[step["operation"]], "headers":[["authorization", "Bearer "+step.get("token", "test-owner")], ["content-type", "application/json"]], "body":json.dumps(self.replace(step["request"])).encode("utf-8")}
    def close(self):
        self.backend.close()
        self.directory.cleanup()


def run_case(case):
    f, report = Fixture(), []
    try:
        for step in case["steps"]:
            f.flags.update(step.get("flags", {}))
            if "issue" in step:
                f.refs[step["issue"]] = f.operations.issue(f.principal, f.refs["@session"], 1800)
                continue
            response = handle_http(f.service, f.request(step))
            body = json.loads(response["body"])
            f.capture(step, body)
            state = f.backend.read("tenant-a", {"kind":"session", "id":f.refs["@session"]})["body"]
            report.append({"status":response["status"], "body":f.normalize(body), "version":state["version"], "state":state["state"]["stage"], "statusAfter":state["status"]})
        return report
    finally:
        f.close()
