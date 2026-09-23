# SPDX-License-Identifier: Apache-2.0
import sys
from pathlib import Path
from types import SimpleNamespace
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/"scripts"))
from psp_cdl_mcp_server import McpServer
from psp_cdl_mcp_server.stdio import serve_stdio
from psp_cdl_mcp_server.revision import RevisionedToolRegistry, REVISION_PROFILE
from psp_cdl_mcpproxy.mcp import StdioMcpClient
from psp_cdl_mcpproxy import McpDispatchGate
from revision_fixtures import APPROVAL, PRINCIPAL, tool
from dispatch_fixtures import Fixture
if len(sys.argv)>1 and sys.argv[1]=="peer":
    registry=RevisionedToolRegistry(SimpleNamespace(authenticate=lambda t:PRINCIPAL if t=="synthetic" else None,authorize=lambda *_:True),[tool(lambda a,_:a)])
    if sys.argv[2]=="tool-2": registry.publish(registry.revision,[tool(lambda a,_:a,"tool-2")])
    serve_stdio(McpServer(registry.service(),lambda:"synthetic"))
else:
    f=Fixture();old=next_peer=None
    def connect(revision): return StdioMcpClient.connect({"executable":sys.executable,"args":[str(Path(__file__).resolve()),"peer",revision],"env":{},"serverInfo":{"name":"psp-cdl-reference","version":"0.1.0"},"timeoutMs":3000,"revisionProfile":REVISION_PROFILE})
    try:
        old=connect("tool-1")
        gate=McpDispatchGate(f.store,f,"registry-1",old.registrations("echo",[APPROVAL],f.now,old.catalog_snapshot["approvalDigest"]))
        def call():
            r=gate.call_tool("test-owner",f.session["sessionId"],{"name":"echo.read","arguments":{"message":"hello"}},f.options)
            print(r["provenance"]["toolRevision"]+" / "+r["provenance"]["registryRevision"])
        call();next_peer=connect("tool-2")
        candidate=next_peer.registrations("echo",[{**APPROVAL,"revision":"tool-2"}],f.now,next_peer.catalog_snapshot["approvalDigest"])
        gate.replace_registry("registry-1","registry-2",candidate)
        f.flags["registryDrift"]=True  # Publish matching host authority after replacement.
        old.close();call()
    finally:
        if old: old.close()
        if next_peer: next_peer.close()
        f.close()
