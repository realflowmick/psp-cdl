# SPDX-License-Identifier: Apache-2.0
import sys
import threading
import time
import unittest
from pathlib import Path
from types import SimpleNamespace
sys.path.insert(0,str(Path(__file__).resolve().parents[3]/"scripts"))
from http_fixtures import SUITE, run_http_case, HttpFixture, request, INITIALIZE, CALL
from psp_cdl_mcpproxy.http import parse_sse
from psp_cdl_mcpproxy.mcp import HttpMcpClient
from psp_cdl_mcp_server.http import McpHttpServer
from http_fixtures import config
import json

class HttpTests(unittest.TestCase):
    def test_principal_pinned_at_service_entry(self):
        endpoint="http://127.0.0.1:8123/mcp"
        p={"tenantId":"tenant","subjectId":"owner","scopes":[]}
        adapter=McpHttpServer(SimpleNamespace(authenticate=lambda *_:p,open=lambda *_:{"service":SimpleNamespace(authenticate=lambda _:{**p,"subjectId":"other"}),"close":lambda:None}),config(endpoint))
        response=adapter.handle(request(endpoint,INITIALIZE))
        self.assertEqual(json.loads(response["body"])["error"]["message"],"IDENTITY_CHANGED")
        self.assertNotIn("mcp-session-id",response["headers"])
        adapter.close()

    def test_unsafe_endpoints_rejected_before_credentials(self):
        def credential(_): self.fail("must not acquire credentials")
        for endpoint in ("http://remote.example/mcp","https://user:secret@tools.example/mcp","https://tools.example/mcp?token=secret","https://tools.example/mcp#x"):
            with self.assertRaisesRegex(ValueError,"INVALID_CONFIGURATION"):
                HttpMcpClient.connect({"endpoint":endpoint,"allowLoopbackHttp":False,"serverInfo":{"name":"peer","version":"1"},"timeoutMs":100},credential)

    def test_release_reauth_and_deadline(self):
        for mode in ("revoke","timeout"):
            endpoint="http://127.0.0.1:8123/mcp"
            f=HttpFixture(endpoint,overrides={"callTimeoutMs":100})
            try:
                sid=f.adapter.handle(request(endpoint,INITIALIZE))["headers"]["mcp-session-id"]
                f.adapter.handle(request(endpoint,{"jsonrpc":"2.0","method":"notifications/initialized"},sid))
                f.f.flags["onInvoke"] = (lambda:f.f.flags.update(revoked=True)) if mode=="revoke" else lambda:time.sleep(.15)
                response=f.adapter.handle(request(endpoint,CALL,sid))
                self.assertEqual(response["status"],401 if mode=="revoke" else 204)
                self.assertNotIn("hello",response["body"])
            finally: f.close()

    def test_shared_boundaries(self):
        for c in SUITE["cases"]:
            with self.subTest(c["id"]): self.assertEqual(run_http_case(c),c["expected"])

    def test_concurrent_cancellation_and_owner_reservation(self):
        entered,finish = threading.Event(),threading.Event()
        def invoke():
            entered.set()
            self.assertTrue(finish.wait(5))
        endpoint = "http://127.0.0.1:8123/mcp"
        f = HttpFixture(endpoint,{"onInvoke":invoke})
        result=[]
        try:
            sid = f.adapter.handle(request(endpoint,INITIALIZE))["headers"]["mcp-session-id"]
            f.adapter.handle(request(endpoint,{"jsonrpc":"2.0","method":"notifications/initialized"},sid))
            worker=threading.Thread(target=lambda:result.append(f.adapter.handle(request(endpoint,CALL,sid))))
            worker.start()
            self.assertTrue(entered.wait(5))
            self.assertEqual(f.adapter.handle(request(endpoint,{**CALL,"id":3},sid))["status"],409)
            cancel = request(endpoint,{"jsonrpc":"2.0","method":"notifications/cancelled","params":{"requestId":2}},sid)
            foreign = {**cancel,"headers":[[k,"Bearer test-other" if k=="authorization" else v] for k,v in cancel["headers"]]}
            self.assertEqual(f.adapter.handle(foreign)["status"],404)
            self.assertEqual(f.adapter.handle(cancel)["status"],202)
            finish.set()
            worker.join(5)
            self.assertFalse(worker.is_alive())
            self.assertEqual((result[0]["status"],result[0]["body"]),(204,""))
            self.assertEqual(f.f.update()["version"],2)
            self.assertEqual(f.adapter.handle(request(endpoint,{},sid,{"method":"DELETE"}))["status"],200)
            self.assertEqual(f.adapter.handle(request(endpoint,{**CALL,"id":4},sid))["status"],404)
        finally:
            finish.set()
            f.close()

    def test_finite_sse(self):
        self.assertEqual(parse_sse(': heartbeat\r\nid: a\r\ndata:\r\n\r\nevent: message\r\ndata: {"result":\r\ndata: {}}\r\n\r\n'),{"result":{}})
        for source in ('data: {}','data: {}\n','data: {}\n\ndata: {}\n\n','event: endpoint\ndata: {}\n\n'):
            with self.assertRaises(Exception): parse_sse(source)
