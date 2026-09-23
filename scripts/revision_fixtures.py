# SPDX-License-Identifier: Apache-2.0
import json
from pathlib import Path
from types import SimpleNamespace
from psp_cdl_mcp_server.revision import RevisionedToolRegistry, REVISION_KEY, revision_digest
from dispatch_fixtures import SUITE as DISPATCH
SUITE=json.loads((Path(__file__).resolve().parents[1]/"conformance/vectors/dispatch/revision-0.1.json").read_text(encoding="utf-8"))
PRINCIPAL={"tenantId":"downstream","subjectId":"host","scopes":["tools:list","tools:call"]}
APPROVAL={"name":"read","revision":"tool-1","readOnly":True,"complete":True,"sources":[{"id":"host-review","capabilities":[]}],"inputSchema":DISPATCH["schema"],"outputSchema":DISPATCH["schema"]}
def tool(invoke,revision="tool-1"):
    return {"name":"read","revision":revision,"readOnly":True,"inputSchema":DISPATCH["schema"],"outputSchema":DISPATCH["schema"],"invoke":invoke}
class RevisionPeer:
    def __init__(self,mode="ok",spy=lambda:None,revision="tool-1"):
        self.mode,self.lists=mode,0
        def invoke(args,_):
            spy()
            return args
        self.tools=[tool(invoke,revision)]
        def authorize(_p,_n,phase):
            if mode=="race" and phase=="invoke": self.registry.publish(self.registry.revision,self.tools)
            return True
        self.registry=RevisionedToolRegistry(SimpleNamespace(authenticate=lambda t:PRINCIPAL if t=="test-downstream" else None,authorize=authorize),self.tools)
    def service(self,cancelled=lambda:False):
        service=self.registry.service(cancelled)
        r=service.revisions
        if self.mode=="unsupported":
            del service.revisions
            return service
        def discover(*args):
            self.lists+=1
            if self.mode=="drift" and self.lists==2: self.registry.publish(self.registry.revision,self.tools)
            result=r.discover(*args)
            if self.mode=="bad-catalog": result["_meta"][REVISION_KEY]["catalogDigest"]="0"*64
            return result
        def call(*args):
            result=r.call_tool(*args)
            if self.mode=="missing-receipt": del result["meta"]
            if self.mode=="forged-receipt": result["meta"][REVISION_KEY]["generation"]+=1
            return result
        service.revisions=SimpleNamespace(profile=r.profile,discover=discover,call_tool=call)
        return service
def run_revision_case(c):
    calls,released,code,cancelled=0,0,"OK",c["id"]=="cancel-before"
    def capture(work):
        nonlocal code
        try: work()
        except Exception as exc: code=getattr(exc,"code","TOOL_ERROR")
    def invoke(args,_):
        nonlocal calls,cancelled
        calls+=1
        if c["id"]=="busy-invoke": capture(lambda:registry.publish(registry.revision,tools))
        if c["id"]=="cancel-after": cancelled=True
        if c["id"]=="lease-failure": raise ValueError("private")
        return args
    tools=[tool(invoke)]
    def authorize(_p,_n,phase):
        if c["id"]=="race-before-select" and phase=="invoke": registry.publish(registry.revision,tools)
        if c["id"]=="busy-release" and phase=="release": capture(lambda:registry.publish(registry.revision,tools))
        return c["id"]!="deny-"+phase
    host=SimpleNamespace(authenticate=lambda _:{**PRINCIPAL,**({"subjectId":"other"} if c["id"]=="identity-change" else {}),**({"scopes":[]} if c["id"]=="no-scope" else {})},authorize=authorize)
    registry=RevisionedToolRegistry(host,tools,"fixture-epoch")
    args={"message":"hello 🧪"}
    pre={**registry.revision,"toolRevision":"tool-1","inputDigest":revision_digest(args),**c.get("patch",{})}
    try:
        if c["id"]=="aba":
            registry.publish(registry.revision,[])
            registry.publish(registry.revision,tools)
        if c["id"]=="publish-conflict": capture(lambda:registry.publish({**registry.revision,"generation":2},[]))
        if c["id"]=="invalid-candidate": capture(lambda:registry.publish(registry.revision,[{**tools[0],"readOnly":False}]))
        service=registry.service(lambda:cancelled)
        result=service.call_tool("read",args,"test-downstream",PRINCIPAL) if c["id"]=="no-negotiation" else service.revisions.call_tool("missing" if c["id"]=="unknown-tool" else "read",args,"test-downstream",PRINCIPAL,None if c["id"]=="missing" else pre)
        assert result=={"data":args,"meta":{REVISION_KEY:pre}}
        released=1
    except Exception as exc: code=getattr(exc,"code","TOOL_ERROR")
    if c["id"]=="lease-failure": registry.publish(registry.revision,tools)
    return {"code":code,"calls":calls,"released":released,"generation":registry.revision["generation"]}
