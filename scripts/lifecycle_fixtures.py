# SPDX-License-Identifier: Apache-2.0
import json
from pathlib import Path
from workflow_fixtures import Fixture as WorkflowFixture, ROUTES as WORKFLOW_ROUTES
from psp_cdl_api_server.lifecycle import LifecycleStore, LifecycleService
from psp_cdl_api_server.http import handle_http
from psp_cdl_mcp_server import McpServer

SUITE=json.loads((Path(__file__).resolve().parents[1]/"conformance/vectors/workflows/lifecycle-0.1.json").read_text())
ROUTES={**WORKFLOW_ROUTES,"listSessions":"/v1/sessions/list","cancelSession":"/v1/sessions/cancel","purgeSession":"/v1/sessions/purge"}

class Fixture(WorkflowFixture):
    def __init__(self):
        super().__init__()
        self.flags["retention"]=True
        self.principal["scopes"]=[*self.principal["scopes"],"sessions:cancel","sessions:purge"]
        self.store=LifecycleStore(self.backend,resume_secret=bytes([7])*32,authorize_persistence=lambda a,w:self.flags["persist"],authorize_retention=lambda a,c:self.flags["retention"])
        self.service=LifecycleService(self.store,self)
    def authorize(self,p,c):
        if c["command"]["action"]=="cancelSession" and self.flags.get("winUpdate"):
            self.flags["winUpdate"]=False
            self.store.execute(self.actor,{"action":"updateSession","requestId":"winner","sessionId":self.refs["@session"],"expectedVersion":1,"nodeId":"entry","nodeVersion":"1","policyVersion":"policy-1","status":"running","state":{"stage":"winner"}})
        if c["command"]["action"]=="cancelSession" and self.flags.get("winResume"):
            self.flags["winResume"]=False
            self.service.invoke("resumeCheckpoint",{"requestId":"winner","checkpointId":self.refs["@cp"],"state":{}},"test-owner")
        return super().authorize(p,c)
    def request(self,step):
        return {"method":"POST","path":ROUTES[step["operation"]],"headers":[["authorization","Bearer "+step.get("token","test-owner")],["content-type","application/json"]],"body":json.dumps(self.replace(step["request"])).encode()}

def run_case(case,mode="http"):
    f,report=Fixture(),[]
    try:
        for step in case["steps"]:
            f.flags.update(step.get("flags",{}))
            if "issue" in step:
                f.refs[step["issue"]]=f.operations.issue(f.principal,f.refs["@session"],1800)
                continue
            if mode=="http":
                r=handle_http(f.service,f.request(step));status,body=r["status"],json.loads(r["body"])
            else:
                peer=McpServer(f.service,lambda:step.get("token","test-owner"))
                peer.handle(json.dumps({"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"test","version":"1"}}}))
                peer.handle(json.dumps({"jsonrpc":"2.0","method":"notifications/initialized"}))
                r=peer.handle(json.dumps({"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"realflow."+ROUTES[step["operation"]][4:].replace("/","."),"arguments":f.replace(step["request"])}}))
                body=r["result"].get("structuredContent") or json.loads(r["result"]["content"][0]["text"]) if "result" in r else {"error":{"code":r["error"]["message"]}}
                status=step["expect"]["status"] if "error" in body else 200
            assert status==step["expect"]["status"],(case["id"],body)
            if "error" in step["expect"]: assert body["error"]["code"]==step["expect"]["error"],(case["id"],body)
            f.capture(step,body)
            s=f.backend.read(f.actor["tenantId"],{"kind":"session","id":f.refs["@session"]})["body"]
            for k,actual in {"state":s["status"],"version":s["version"],"count":len(body["result"]["sessions"]) if "sessions" in body.get("result",{}) else None,"cleaned":body.get("result",{}).get("cleaned"),"more":body.get("result",{}).get("more")}.items():
                if k in step: assert actual==step[k],(case["id"],k,actual,step[k])
            assert "PRIVATE_" not in json.dumps(body) and "resumeToken" not in json.dumps(body)
            report.append({"status":status,"body":f.normalize(body),"version":s["version"],"state":s["status"]})
        return report
    finally:f.close()
