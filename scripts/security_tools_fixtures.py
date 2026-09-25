# SPDX-License-Identifier: Apache-2.0
import json
from copy import deepcopy
from pathlib import Path
from psp_cdl_api_server.security_tools import SecurityToolsService
from psp_cdl_api_server.http import handle_http
from psp_cdl_mcp_server import McpServer
from lifecycle_fixtures import Fixture as LifecycleFixture
SUITE=json.loads((Path(__file__).resolve().parents[1]/"conformance/vectors/services/security-tools-0.1.json").read_text(encoding="utf-8"))
RESOURCE={"classes":[],"covenants":[],"capabilities":[],"checks":{},"parameters":{},"context":{}}

class Fixture:
    def __init__(self,c=None):
        c=c or {};self.flags={"now":1000,**c.get("flags",{})};self.counts={"keyCalls":0,"releaseCalls":0}
        self.principal={"tenantId":"tenant-a","subjectId":"subject-a","scopes":["security:scan","security:decrypt","security:process","security:verify","policy:evaluate"]}
        self.snapshot={**self.principal,"operationId":"op-1","policyVersion":"policy-1","expires":1900,"resources":[deepcopy(RESOURCE)],"verification":{"keys":[{"id":"test-sign","algorithm":"hmac-sha256","material":bytes.fromhex(SUITE["signingKeyHex"]),"status":"active","trustLevels":[2],"sectionTypes":["system","context","user"],"scope":{},"allowUnscoped":False}],"context":{"tenant-id":"tenant-a","operation-id":"op-1","policy-version":"policy-1"},"allowedAttributes":["tenant-id","operation-id","policy-version","encrypted","encryption-algorithm","encryption-key-id","nonce","tag","decrypt"]}}
        if self.flags.get("policyDenies"):self.snapshot["resources"][0].update(covenants=["no-collect"],capabilities=["collects-data"])
        self.service=SecurityToolsService(self)
        self.request=self.replace(c.get("request",{"operation_id":"op-1","raw_text":"@text"}))
        if self.flags.get("oversize"):self.request["raw_text"]="🧪"*300000
        self.token=self.flags.get("token","test-owner")
    def now(self):return self.flags["now"]
    def authenticate(self,token):
        if self.flags.get("revoked"):return None
        if token=="test-owner":return self.principal
        if token=="reader":return {**self.principal,"scopes":[]}
        if token=="other-owner":return {**self.principal,"subjectId":"other"}
        if token=="other-tenant":return {**self.principal,"tenantId":"other"}
        return None
    def resolve(self,p,operation):return self.snapshot
    def resolve_decryption(self,p,c):
        f=self.flags;self.counts["keyCalls"]+=1
        if f.get("throwKey"):raise RuntimeError("PRIVATE_KEY_BACKEND")
        if f.get("missingKey"):return None
        return {**c,"tenantId":"other" if f.get("wrongTenantGrant") else "tenant-a","subjectId":"other" if f.get("wrongOwnerGrant") else "subject-a","envelopeDigest":"0"*64 if f.get("wrongDigest") else c["envelopeDigest"],"algorithm":"aes-256-gcm","material":bytes(32) if f.get("wrongKey") else bytes.fromhex(SUITE["encryptionKeyHex"]),"status":"revoked" if f.get("revokedKey") else "active","expires":1000 if f.get("expiredGrant") else 1800,"requestingZone":2 if f.get("zoneDenied") else 0,"sectionTypes":["system","context"],"modes":[] if f.get("modeDenied") else ["upfront","node","on-request"],"applicationOnly":not f.get("bootstrapDenied")}
    def plaintext_policy(self,p,c):
        f=self.flags;self.counts["releaseCalls"]+=1
        if f.get("throwRelease"):raise RuntimeError("PRIVATE_POLICY_BACKEND")
        if f.get("mutateOutput"):c["outputs"][0]["content"]="TAMPERED"
        if f.get("revokeAtRelease"):f["revokedKey"]=True
        if f.get("revokeSigningAtRelease"):self.snapshot["verification"]["keys"][0]["status"]="revoked"
        if f.get("expireAtRelease"):f["now"]=2000
        if f.get("changePolicyAtRelease"):self.snapshot["policyVersion"]="policy-2"
        if f.get("revokeCredentialAtRelease"):f["revoked"]=True
        return {"allow":"yes" if f.get("truthyRelease") else not f.get("denyRelease"),"complete":not f.get("incompleteRelease"),"resources":[{**deepcopy(RESOURCE),"covenants":["no-display-to-operator"] if f.get("releasePolicyDenies") else [],"capabilities":["can-display-to-operator"] if f.get("releasePolicyDenies") else []}]}
    def replace(self,v):
        if type(v) is str:return SUITE["contents"].get(v,v)
        if type(v) is list:return [self.replace(x) for x in v]
        if type(v) is dict:return {k:self.replace(x) for k,x in v.items()}
        return v

def run_case(c,mode="http"):
    f=Fixture(c)
    if mode=="http":
        r=handle_http(f.service,{"method":"POST","path":"/v1/security/"+c["operation"],"headers":[["authorization","Bearer "+f.token],["content-type","application/json"]],"body":json.dumps(f.request,ensure_ascii=False).encode()})
        status,body=r["status"],json.loads(r["body"])
    else:
        peer=McpServer(f.service,lambda:f.token)
        peer.handle(json.dumps({"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"test","version":"1"}}}))
        peer.handle(json.dumps({"jsonrpc":"2.0","method":"notifications/initialized"}))
        r=peer.handle(json.dumps({"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"realflow.security."+c["operation"],"arguments":f.request}},ensure_ascii=False))
        body=r["result"].get("structuredContent") or json.loads(r["result"]["content"][0]["text"]) if "result" in r else {"error":{"code":r["error"]["message"]}}
        status=c["expect"]["status"] if "error" in body else 200
    e=c["expect"]
    assert status==e["status"],(c["id"],body)
    if "error" in e:assert body["error"]["code"]==("Parse error" if mode=="mcp" and c["flags"].get("oversize") else e["error"]),(c["id"],body)
    if "errors" in e:assert [r.get("error") for r in body["results"]]==e["errors"],(c["id"],body)
    if "contents" in e:assert [r.get("content") for r in body["results"]]==e["contents"],c["id"]
    if "untrustedText" in e:assert body["untrustedText"]==e["untrustedText"],c["id"]
    if "success" in e:assert body["success"]==e["success"],c["id"]
    for k in ("keyCalls","releaseCalls"):
        if k in e:assert f.counts[k]==e[k],(c["id"],k,f.counts[k],e[k])
    assert "PRIVATE_" not in json.dumps(body) and SUITE["encryptionKeyHex"] not in json.dumps(body)
    return {"status":status,"body":body,"counts":f.counts}

class CombinedFixture(Fixture):
    def __init__(self):
        super().__init__()
        self.workflow=LifecycleFixture()
        self.principal["scopes"]=[*self.principal["scopes"],*self.workflow.principal["scopes"]]
        self.service=SecurityToolsService(self,self.workflow.service)
    def close(self):self.workflow.close()
