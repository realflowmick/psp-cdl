# SPDX-License-Identifier: Apache-2.0
import json
import sys
import threading
import unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[3]/"scripts"))
from revision_fixtures import SUITE, run_revision_case, RevisionPeer, APPROVAL, PRINCIPAL
from dispatch_fixtures import Fixture
from psp_cdl_mcp_server import McpServer
from psp_cdl_mcp_server.revision import REVISION_PROFILE, REVISION_KEY, revision_digest
from psp_cdl_mcpproxy import McpDispatchGate
from psp_cdl_mcpproxy.peer import PinnedMcpClient, PeerError

class Client(PinnedMcpClient):
    def __init__(self,peer):
        self.server,self.id,self.closed=McpServer(peer.service(),lambda:"test-downstream"),0,False
        self._initialize({"name":"psp-cdl-reference","version":"0.1.0"},REVISION_PROFILE)
    def _request(self,method,params,cancelled=lambda:False):
        self.id+=1
        r=self.server.handle(json.dumps({"jsonrpc":"2.0","id":self.id,"method":method,"params":params}))
        if "error" in r: raise PeerError(r["error"]["message"])
        return r["result"]
    def _notify(self,method,params): self.server.handle(json.dumps({"jsonrpc":"2.0","method":method,"params":params}))
    def close(self): self.closed=True

class RevisionTests(unittest.TestCase):
    def test_shared(self):
        for c in SUITE["cases"]:
            with self.subTest(c=c["id"]): self.assertEqual(run_revision_case(c),c["expected"])
    def test_approval_receipts_and_negotiation(self):
        for mode,code,calls in [("ok","OK",1),("race","INVALID_TOOL_RESPONSE",0),("drift","DISCOVERY_CHANGED",0),("missing-receipt","INVALID_REVISION_RECEIPT",1),("forged-receipt","INVALID_REVISION_RECEIPT",1),("bad-catalog","INVALID_REVISION_DATA",0),("unsupported","REVISION_UNSUPPORTED",0)]:
            with self.subTest(mode=mode):
                count=[]
                try:
                    p=Client(RevisionPeer(mode,lambda:count.append(1)))
                    with self.assertRaisesRegex(PeerError,"CATALOG_NOT_APPROVED"): p.registrations("echo",[APPROVAL],lambda:1000)
                    with self.assertRaisesRegex(PeerError,"DISCOVERY_MISMATCH"): p.registrations("echo",[{**APPROVAL,"revision":"other"}],lambda:1000,p.catalog_digest)
                    p.catalog_snapshot["tools"].clear()
                    self.assertEqual(len(p.catalog_snapshot["tools"]),1)
                    r=p.registrations("echo",[APPROVAL],lambda:1000,p.catalog_snapshot["approvalDigest"])[0]
                    result=r["invoke"]({"message":"hello"},{"deadline":1800,"cancelled":lambda:False})
                    self.assertEqual(code,"OK");self.assertEqual(result,{"message":"hello"})
                except PeerError as exc: self.assertEqual(exc.code,code)
                self.assertEqual(len(count),calls)
    def test_refresh(self):
        f=Fixture();calls=[]
        try:
            p=Client(RevisionPeer("ok",lambda:calls.append(1)));n=Client(RevisionPeer("ok",lambda:calls.append(1),"tool-2"))
            regs=p.registrations("echo",[APPROVAL],f.now,p.catalog_digest)
            candidate=n.registrations("echo",[{**APPROVAL,"revision":"tool-2"}],f.now,n.catalog_digest)
            gate=McpDispatchGate(f.store,f,"registry-1",regs)
            def call(name="echo.read"): return gate.call_tool("test-owner",f.session["sessionId"],{"name":name,"arguments":{"message":"hello"}},f.options)
            with self.assertRaisesRegex(ValueError,"REVISION_CONFLICT"): gate.replace_registry("wrong","registry-2",candidate)
            with self.assertRaisesRegex(ValueError,"UNSUPPORTED_SCHEMA"): gate.replace_registry("registry-1","registry-2",[{**candidate[0],"inputSchema":{"type":"string"}}])
            self.assertEqual(call()["provenance"]["toolRevision"],"tool-1")
            gate.replace_registry("registry-1","registry-2",candidate)
            with self.assertRaisesRegex(ValueError,"STALE_AUTHORITY"): call()
            self.assertEqual(len(calls),1)
            f.flags["registryDrift"]=True
            self.assertEqual(call()["provenance"]["toolRevision"],"tool-2")
            with self.assertRaisesRegex(ValueError,"INVALID_REGISTRY_REVISION"): gate.replace_registry("registry-2","registry-1",regs)
            gate.replace_registry("registry-2","registry-3",[{**candidate[0],"sources":[{"id":"host","capabilities":["used-for-model-training"]}]}])
            original=f.snapshot;f.snapshot=lambda *_:{**original(),"registryRevision":gate.registry_revision}
            with self.assertRaisesRegex(ValueError,"POLICY_DENIED"): call()
            self.assertEqual(len(calls),2)
            gate.replace_registry("registry-3","registry-4",[{**candidate[0],"server":"unapproved"}])
            for name in ("unapproved.read","echo.read"):
                with self.assertRaisesRegex(ValueError,"TOOL_NOT_ALLOWED"): call(name)
        finally: f.close()
    def test_gate_busy_from_authentication_through_release(self):
        f=Fixture();entered,finish=threading.Event(),threading.Event();original=f.authenticate
        def authenticate(t):
            entered.set();finish.wait(3)
            return original(t)
        f.authenticate=authenticate
        def worker():
            try: f.gate.list_tools("test-other",f.session["sessionId"],f.options)
            except ValueError: pass
        thread=threading.Thread(target=worker)
        try:
            thread.start();self.assertTrue(entered.wait(3))
            with self.assertRaisesRegex(ValueError,"REGISTRY_BUSY"): f.gate.replace_registry("registry-1","registry-2",[])
            finish.set();thread.join();f.authenticate=original
            def busy():
                with self.assertRaisesRegex(ValueError,"REGISTRY_BUSY"): f.gate.replace_registry("registry-1","registry-2",[])
            f.flags["onInvoke"]=busy;policy=f.policy
            def check_policy(*args):
                busy();return policy(*args)
            f.policy=check_policy
            f.gate.call_tool("test-owner",f.session["sessionId"],{"name":"echo.read","arguments":{"message":"hello"}},f.options)
            f.gate.replace_registry("registry-1","registry-2",[])
            self.assertEqual(f.gate.registry_revision,"registry-2")
        finally: finish.set();thread.join();f.close()
    def test_registry_lease_across_threads(self):
        entered,finish=threading.Event(),threading.Event();results=[]
        def spy(): entered.set();finish.wait(3)
        p=RevisionPeer("ok",spy);r=p.registry;svc=p.service();args={"message":"hello"}
        pre={**r.revision,"toolRevision":"tool-1","inputDigest":revision_digest(args)}
        thread=threading.Thread(target=lambda:results.append(svc.revisions.call_tool("read",args,"test-downstream",PRINCIPAL,pre)))
        try:
            thread.start();self.assertTrue(entered.wait(3))
            with self.assertRaisesRegex(ValueError,"REGISTRY_BUSY"): r.publish(r.revision,[])
        finally: finish.set();thread.join()
        self.assertEqual(len(results),1);self.assertEqual(r.publish(r.revision,[])["generation"],2)

if __name__=="__main__": unittest.main()
