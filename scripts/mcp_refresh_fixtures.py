# SPDX-License-Identifier: Apache-2.0
import json
from copy import deepcopy
from pathlib import Path
from psp_cdl_mcpproxy.peer import PinnedMcpClient, PeerError
from psp_cdl_mcp_server import McpServer
from psp_cdl_core import canonical_json,envelope_to_section,serialize_markup
from psp_cdl_core.crypto import sign_envelope
from psp_cdl_llmproxy import McpPromptRefresher,mcp_refresh_tool_definition
SUITE=json.loads((Path(__file__).resolve().parents[1]/"conformance/vectors/llm/mcp-refresh-0.1.json").read_text(encoding="utf-8"))
PRINCIPAL={"tenantId":"tenant","subjectId":"owner","scopes":["models:invoke","sessions:write"]}
BINDING={"tenantId":"tenant","subjectId":"owner","sessionId":"session-1","deadline":2000}
REQUEST={"session_id":"session-1","current_version":"1.0.0","trigger":"expiration","turn_count":2}
def markup(e):return serialize_markup({"kind":"document","children":[envelope_to_section(e)]},"canonical")
def envelope():return sign_envelope("Fresh system 🧪",{"algorithm":"hmac-sha256","signatureVersion":"2.0","secretId":"synthetic","timestamp":1100,"expires":1600,"version":"1.0.1","sectionType":"system","contentType":"text"},bytes([19])*32)

class TestPeer(PinnedMcpClient):
    def __init__(self,mode="normal",issue=lambda _:envelope()):
        self.mode,self.issue=mode,issue
        self.calls=self.lists=0;self.closed=self.cancelled=False;self.wire=[];self.now=1100
        self.server=McpServer(self,lambda:"synthetic")
    def authenticate(self,_):return deepcopy(PRINCIPAL)
    def discover(self,*_):
        self.lists+=1;tool=mcp_refresh_tool_definition()
        if self.mode=="equivalent":tool["name"]="refresh"
        if self.mode=="missing":return []
        if self.mode=="schema":tool["inputSchema"]["properties"]["turn_count"]["maximum"]=99
        if self.mode=="drift-before" and self.lists>1 or self.mode=="drift-after" and self.calls:tool["description"]="changed"
        return [tool,tool] if self.mode=="duplicate" else [tool]
    def call_tool(self,name,args,*_):
        self.calls+=1;self.wire.append({"name":name,"arguments":args})
        e=self.issue(args);prompt=markup(e)
        if self.mode=="malformed":prompt="not a section"
        if self.mode=="multiple":prompt+=prompt
        if self.mode=="not-system":e["signature"]["sectionType"]="user";prompt=markup(e)
        if self.mode=="nested":prompt='${psp type=system}${psp type=user}nested${/psp}${/psp}'
        if self.mode=="expired-after":self.now=2000
        if self.mode=="cancelled-after":self.cancelled=True
        data={"prompt":prompt,"secret":"PRIVATE"} if self.mode=="extra-output" else {} if self.mode=="missing-output" else {"prompt":"x"*262145} if self.mode=="oversize-output" else {"prompt":prompt}
        return {"data":data,"meta":{"untrusted":"PRIVATE_META"}}
    def connect(self):self._initialize({"name":"psp-cdl-reference","version":"0.1.0"});return self
    def _request(self,method,params,cancelled=lambda:False):
        if cancelled():raise PeerError("PEER_CANCELLED")
        reply=self.server.handle(canonical_json({"jsonrpc":"2.0","id":1,"method":method,"params":params}))
        if "error" in reply:raise PeerError("PEER_ERROR")
        if method=="tools/call" and self.mode=="bad-text":reply["result"]["content"]=[{"type":"text","text":"PRIVATE"}]
        return reply["result"]
    def _notify(self,method,params):self.server.handle(canonical_json({"jsonrpc":"2.0","method":method,"params":params}))
    def close(self):self.closed=True

def run_case(case):
    peer=TestPeer(case["mode"]);p=deepcopy(PRINCIPAL);b=deepcopy(BINDING);r={**REQUEST,**case.get("request",{})}
    try:
        peer.connect()
        client=McpPromptRefresher(peer,{"principal":p,"sessionId":b["sessionId"],"approvedCatalogDigest":"wrong" if peer.mode=="unapproved" else peer.catalog_digest,"now":lambda:peer.now,"cancelled":lambda:peer.cancelled,**({"toolName":"refresh"} if peer.mode=="equivalent" else {})})
        if peer.mode=="owner":p["subjectId"]="other"
        if peer.mode=="binding":b["tenantId"]="other"
        if peer.mode=="session":r["session_id"]="other"
        if peer.mode=="expired":peer.now=2000
        if peer.mode=="cancelled":peer.cancelled=True
        result=client.refresh(p,b,r)
        return {"code":"OK","calls":peer.calls,"released":1,"data":result["data"],"wire":peer.wire}
    except Exception as exc:return {"code":getattr(exc,"code","UNEXPECTED_ERROR"),"calls":peer.calls,"released":0,"wire":peer.wire}
    finally:peer.close()
