# SPDX-License-Identifier: Apache-2.0
"""Disposable synthetic host, not an authentication or business-policy implementation."""
import json
import secrets
import tempfile
import time
from pathlib import Path
from psp_cdl_api_server.persistence import WorkflowStore
from psp_cdl_api_server.sqlite import SqliteBackend
from psp_cdl_api_server.workflow import WorkflowService
from psp_cdl_api_server.http import handle_http

now = lambda: int(time.time())
credential = secrets.token_hex(32)
actor = {"tenantId":"synthetic-tenant", "subjectId":"synthetic-owner"}
principal = {**actor,"scopes":["sessions:read","sessions:write","checkpoints:write","checkpoints:resume"]}


class Host:
    def __init__(self):
        self.checkpoints = {}
        self.approval_granted = False
    def authenticate(self, token): return principal if token == credential else None
    def now(self): return now()
    def resolve(self, *_): return None
    def policy_version(self, _): return "demo-policy-1"
    def authorize(self, p, context):
        command, current = context["command"], context["current"]
        if command["action"] == "resumeCheckpoint": return self.approval_granted
        if context["replay"]: return True  # Owner checked by store; acknowledgement only.
        if command["action"] == "createSession": return command["nodeId"] == "entry"
        if command["action"] == "updateSession": return current["nodeId"] == "entry" and command["nodeId"] == "review"
        return command["action"] == "getSession" or (command["action"] == "createCheckpoint" and current["nodeId"] == "review")
    def present(self, p, operation, state): return {"stage":state["stage"]}
    def deliver_checkpoint(self, p, c): self.checkpoints[(p["tenantId"],p["subjectId"],c["checkpointId"])] = c["resumeToken"]
    def resume_token(self, p, id): return self.checkpoints.get((p["tenantId"],p["subjectId"],id))


with tempfile.TemporaryDirectory(prefix="psp-example-") as directory:
    backend = SqliteBackend(str(Path(directory)/"workflow.sqlite"),"demo-epoch",now)
    store = WorkflowStore(backend,resume_secret=secrets.token_bytes(32),authorize_persistence=lambda *_:True)  # Synthetic data only.
    host = Host()
    service = WorkflowService(store,host)
    def call(route,args,expected=200):
        response = handle_http(service,{"method":"POST","path":"/v1/"+route,"headers":[["authorization","Bearer "+credential],["content-type","application/json"]],"body":json.dumps(args).encode()})
        assert response["status"] == expected, response["body"]
        return json.loads(response["body"])
    try:
        for node_id in ("entry","review"):
            store.execute(actor,{"action":"putNode","nodeId":node_id,"nodeVersion":"1","definition":{"label":node_id}})
        created = call("sessions/create",{"requestId":"create","nodeId":"entry","nodeVersion":"1","expiresAt":now()+600,"state":{"stage":"created"}})
        session_id = created["result"]["sessionId"]
        saved = call("sessions/update",{"requestId":"save","sessionId":session_id,"expectedVersion":1,"nodeId":"review","nodeVersion":"1","status":"running","state":{"stage":"saved"}})
        paused = call("checkpoints/create",{"requestId":"pause","sessionId":session_id,"expectedVersion":2,"expiresAt":now()+300})
        command = {"requestId":"resume","checkpointId":paused["result"]["checkpointId"],"state":{"stage":"resumed"}}
        denied = call("checkpoints/resume",command,403)
        # Trusted application approval, outside the submitted state.
        host.approval_granted = True
        resumed = call("checkpoints/resume",command)
        assert call("checkpoints/resume",command) == resumed
        print(json.dumps({"created":created["result"]["version"],"saved":saved["result"]["version"],"paused":paused["result"]["sessionVersion"],"denied":denied["error"]["code"],"resumed":resumed["result"]["version"],"view":resumed["result"]["view"]}))
    finally:
        backend.close()
