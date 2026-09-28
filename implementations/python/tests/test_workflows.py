# SPDX-License-Identifier: Apache-2.0
import json
import sys
import unittest
from pathlib import Path
ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0,str(ROOT/"scripts"))
from workflow_fixtures import SUITE, Fixture, run_case
from psp_cdl_api_server.operations import SessionOperations
from psp_cdl_api_server.service import ServiceError
from psp_cdl_mcp_server import McpServer
from psp_cdl_core.crypto import sign_envelope
from psp_cdl_core import serialize_markup, envelope_to_section, select_transition, TRANSITION_PROFILE, PspError
from psp_cdl_api_server.http import handle_http


class WorkflowTests(unittest.TestCase):
    def test_qualified_transitions_guard_real_commits(self):
        f = Fixture()
        try:
            trust_level, faults = 5, []

            def authorize(principal, context):
                command, current = context["command"], context["current"]
                if command["action"] != "updateSession" or context["replay"] or current["nodeId"] != "entry" or command["status"] != "running":
                    return False
                try:
                    selected = select_transition({"profile": TRANSITION_PROFILE, "nodeId": current["nodeId"], "completed": True,
                        "siblings": ["entry", "next"], "attributes": {"transition-endpoints": "mcp://erp/*"},
                        "transitions": [{"condition": "approved == true", "target_node": "next"}],
                        "facts": {"approved": {"value": True, "origins": [{"endpoint": "mcp://erp/approval", "trustLevel": trust_level,
                            "priority": 50, "signatureVerified": True}]}}})
                    return selected["targetNode"] == command["nodeId"] and command["nodeVersion"] == "1"
                except PspError as error:
                    faults.append(error.code)
                    return False

            f.authorize = authorize
            command = {"requestId": "qualified-transition", "sessionId": f.refs["@session"], "expectedVersion": 1,
                       "nodeId": "next", "nodeVersion": "1", "status": "running", "state": {"stage": "routed", "approved": True, "trustLevel": 0}}
            with self.assertRaises(ServiceError) as caught:
                f.service.invoke("updateSession", command, "test-owner")
            self.assertEqual(caught.exception.code, "AUTHORIZATION_DENIED")
            self.assertEqual(faults, ["INSUFFICIENT_QUALIFIED_DATA"])
            self.assertEqual(f.store.execute(f.actor, {"action": "getSession", "sessionId": f.refs["@session"]})["version"], 1)
            trust_level = 3
            with self.assertRaises(ServiceError) as caught:
                f.service.invoke("updateSession", {**command, "nodeId": "entry"}, "test-owner")
            self.assertEqual(caught.exception.code, "AUTHORIZATION_DENIED")
            result = f.service.invoke("updateSession", command, "test-owner")
            self.assertEqual(result["result"]["version"], 2)
            self.assertEqual(f.store.execute(f.actor, {"action": "getSession", "sessionId": f.refs["@session"]})["nodeId"], "next")
            with self.assertRaises(ServiceError) as caught:
                f.service.invoke("updateSession", {**command, "requestId": "stale"}, "test-owner")
            self.assertEqual(caught.exception.code, "STATE_CONFLICT")
        finally:
            f.close()

    def test_access_context_preserves_storage_size_limits(self):
        f = Fixture()
        try:
            for version in (1,2):
                result = f.service.invoke("updateSession",{"requestId":"large-"+str(version),"sessionId":f.refs["@session"],"expectedVersion":version,"nodeId":"entry","nodeVersion":"1","status":"running","state":{"stage":"large","payload":"x"*370000}},"test-owner")
                self.assertEqual(result["result"]["version"],version+1)
        finally: f.close()

    def test_bound_verification_and_fresh_key_revocation(self):
        f = Fixture()
        try:
            key = {"id":"test","algorithm":"hmac-sha256","material":bytes([9])*32,"status":"active","trustLevels":[2],"sectionTypes":["context"],"scope":{},"allowUnscoped":False}
            base = f.snapshot
            f.snapshot = lambda *args:{**base(*args),"verification":{"keys":[key],"context":{},"allowedAttributes":[]}}
            operation = f.operations.issue(f.principal,f.refs["@session"],1800)
            snapshot = f.operations.resolve(f.principal,operation)
            def content(attributes):
                envelope = sign_envelope("synthetic",{"algorithm":"hmac-sha256","signatureVersion":"2.0","secretId":"test","timestamp":1000,"expires":1500,"version":"1.0.0","sectionType":"context","contentType":"text","attributes":attributes},key["material"])
                return serialize_markup({"kind":"document","children":[envelope_to_section(envelope)]})
            context = snapshot["verification"]["context"]
            request = {"operation_id":operation,"sections":[{"id":"good","content":content(context)},{"id":"wrong-node","content":content({**context,"node-id":"other"})}]}
            result = f.service.invoke("verify",request,"test-owner")
            self.assertEqual(result["summary"],{"total":2,"valid":1,"invalid":1})
            self.assertEqual(result["results"][1]["error"],"SCOPE_MISMATCH")
            key["status"] = "revoked"
            self.assertTrue(all(r["error"] == "REVOKED_KEY" for r in f.service.invoke("verify",request,"test-owner")["results"]))
        finally: f.close()

    def test_http_identity_pin_and_mcp_scope_filter(self):
        f = Fixture()
        try:
            original, calls = f.authenticate, 0
            def authenticate(token):
                nonlocal calls
                calls += 1
                return original(token) if calls == 1 else {**original(token),"subjectId":"changed"}
            f.authenticate = authenticate
            step = next(c for c in SUITE["cases"] if c["id"] == "update-and-retry")["steps"][0]
            response = handle_http(f.service,f.request(step))
            self.assertEqual(response["status"],403)
            self.assertEqual(f.backend.read("tenant-a",{"kind":"session","id":f.refs["@session"]})["revision"],1)
            f.authenticate = original
            server = McpServer(f.service,lambda:"test-reader")
            server.handle(json.dumps({"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"test","version":"1"}}}))
            server.handle(json.dumps({"jsonrpc":"2.0","method":"notifications/initialized"}))
            result = server.handle(json.dumps({"jsonrpc":"2.0","id":2,"method":"tools/list"}))
            self.assertEqual([t["name"] for t in result["result"]["tools"]],["realflow.sessions.get","realflow.nodes.fetch"])
        finally: f.close()
    def test_shared_scenarios(self):
        for case in SUITE["cases"]:
            with self.subTest(case=case["id"]):
                report = run_case(case)
                self.assertEqual(report,case["expected"])
                self.assertNotIn("PRIVATE_",json.dumps(report))
                self.assertNotIn("resumeToken",json.dumps(report))

    def test_mcp_checkpoint_flow(self):
        f = Fixture()
        try:
            server = McpServer(f.service,lambda:"test-owner")
            server.handle(json.dumps({"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"test","version":"1"}}}))
            server.handle(json.dumps({"jsonrpc":"2.0","method":"notifications/initialized"}))
            listed = server.handle(json.dumps({"jsonrpc":"2.0","id":2,"method":"tools/list"}))
            self.assertEqual(len(listed["result"]["tools"]),8)
            case = next(c for c in SUITE["cases"] if c["id"] == "checkpoint-resume")
            for index,step in enumerate(case["steps"]):
                name = "realflow."+{"createCheckpoint":"checkpoints.create","resumeCheckpoint":"checkpoints.resume"}[step["operation"]]
                result = server.handle(json.dumps({"jsonrpc":"2.0","id":index+3,"method":"tools/call","params":{"name":name,"arguments":f.replace(step["request"])}}))["result"]
                self.assertEqual(result["isError"],index==3)
                if index<3: f.capture(step,result["structuredContent"])
                self.assertNotIn("resumeToken",json.dumps(result))
        finally: f.close()

    def test_operation_lifecycle_and_snapshot_race(self):
        f = Fixture()
        try:
            registry = SessionOperations(f.store,f,capacity=1)
            operation = registry.issue(f.principal,f.refs["@session"],1800)
            with self.assertRaises(ServiceError) as error: registry.issue(f.principal,f.refs["@session"],1800)
            self.assertEqual(error.exception.code,"OPERATION_CAPACITY")
            first = registry.resolve(f.principal,operation)
            self.assertEqual(first["verification"]["context"]["session-version"],"1")
            first["verification"]["context"]["node-id"] = "mutated"
            self.assertEqual(registry.resolve(f.principal,operation)["verification"]["context"]["node-id"],"entry")
            self.assertIsNone(SessionOperations(f.store,f).resolve(f.principal,operation))
            registry.revoke(operation)
            self.assertIsNone(registry.resolve(f.principal,operation))
            operation = registry.issue(f.principal,f.refs["@session"],1800)
            original = f.snapshot
            def snapshot(*args):
                f.store.execute(f.actor,{"action":"updateSession","requestId":"during-snapshot","sessionId":f.refs["@session"],"expectedVersion":1,"nodeId":"next","nodeVersion":"1","policyVersion":"policy-1","status":"running","state":{"stage":"changed"}})
                return original(*args)
            f.snapshot = snapshot
            with self.assertRaises(ServiceError) as error: registry.resolve(f.principal,operation)
            self.assertEqual(error.exception.code,"STALE_OPERATION")
        finally: f.close()
