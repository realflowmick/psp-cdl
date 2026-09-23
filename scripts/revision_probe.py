# SPDX-License-Identifier: Apache-2.0
import json
import sys
from psp_cdl_mcpproxy.mcp import HttpMcpClient, StdioMcpClient
from psp_cdl_mcpproxy import McpDispatchGate
from revision_fixtures import APPROVAL
from dispatch_fixtures import Fixture
c=json.loads(sys.argv[1]);p=n=f=None
def connect(config): return HttpMcpClient.connect(config,lambda _:"test-downstream") if c["transport"]=="http" else StdioMcpClient.connect(config)
try:
    p=connect(c["config"]);f=Fixture()
    regs=p.registrations("echo",[APPROVAL],f.now,"wrong" if c.get("unapproved") else p.catalog_snapshot["approvalDigest"])
    gate=McpDispatchGate(f.store,f,"registry-1",regs)
    def call(): return gate.call_tool("test-owner",f.session["sessionId"],{"name":"echo.read","arguments":{"message":"hello 🧪"}},f.options)
    result=call()
    if c.get("nextConfig"):
        n=connect(c["nextConfig"])
        candidate=n.registrations("echo",[{**APPROVAL,"revision":"tool-2"}],f.now,n.catalog_snapshot["approvalDigest"])
        gate.replace_registry("registry-1","registry-2",candidate);f.flags["registryDrift"]=True;p.close()
        result=call()
    print(json.dumps({"code":"OK","released":1,"data":result["data"],"toolRevision":result["provenance"]["toolRevision"],"registryRevision":result["provenance"]["registryRevision"]},ensure_ascii=False))
except Exception as exc: print(json.dumps({"code":getattr(exc,"code","UNEXPECTED_ERROR"),"released":0}))
finally:
    if p: p.close()
    if n: n.close()
    if f: f.close()
