# SPDX-License-Identifier: Apache-2.0
import io
import json
import sys
import threading
import unittest
import urllib.request
from pathlib import Path
from wsgiref.simple_server import make_server, WSGIRequestHandler
ROOT=Path(__file__).resolve().parents[3]
sys.path.insert(0,str(ROOT/'scripts'))
from service_fixtures import fixture, SUITE
from psp_cdl_api_server import MAX_REQUEST_BYTES
from psp_cdl_api_server.http import handle_http,create_wsgi_app
from psp_cdl_mcp_server import McpServer
from psp_cdl_mcp_server.stdio import serve_stdio

INITIALIZE={"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"test","version":"1"}}}
INITIALIZED={"jsonrpc":"2.0","method":"notifications/initialized"}
LIST={"jsonrpc":"2.0","id":2,"method":"tools/list"}
CALL={"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"realflow.policy.evaluate","arguments":{"operation_id":"op-1"}}}
def send(server,message): return server.handle(json.dumps(message))
class QuietHandler(WSGIRequestHandler):
    def log_message(self,*args): pass
    def setup(self):
        super().setup()
        self.connection.settimeout(5)

class ServiceTests(unittest.TestCase):
    def test_shared_http_vectors(self):
        for case in SUITE['httpCases']:
            with self.subTest(case=case['id']):
                service,request,host=fixture(case)
                result=handle_http(service,request)
                self.assertEqual({'status':result['status'],'body':json.loads(result['body'])},case['expected'])
                self.assertEqual(result['headers']['cache-control'],'no-store')
                self.assertNotIn('PRIVATE_BACKEND_DETAIL',result['body'])
                if result['status'] in (400,401,403,405,415): self.assertEqual(host.resolutions,0)

    def test_body_bounds_and_encoding(self):
        for body,status in [(bytes(MAX_REQUEST_BYTES+1),413),(b'\xff',400)]:
            service,request,host=fixture()
            self.assertEqual(handle_http(service,{**request,'body':body})['status'],status)
            self.assertEqual(host.resolutions,0)

    def test_identity_pin_and_mixed_batch(self):
        from psp_cdl_api_server import ServiceError
        service,_,host=fixture()
        with self.assertRaises(ServiceError) as error:
            service.invoke('evaluate',{'operation_id':'op-1'},'public-token-a',{'tenantId':'tenant-b','subjectId':'subject-a'})
        self.assertEqual(error.exception.code,'FORBIDDEN');self.assertEqual(host.resolutions,0)
        good=next(c['request']['sections'][0] for c in SUITE['httpCases'] if c['id']=='verify-valid')
        bad=next(c['request']['sections'][0] for c in SUITE['httpCases'] if c['id']=='verify-tampered')
        result=service.invoke('verify',{'operation_id':'op-1','sections':[good,{**bad,'id':'s2'}]},'public-token-a')
        self.assertEqual(result['summary'],{'total':2,'valid':1,'invalid':1})

    def test_wsgi_real_http(self):
        service,request,host=fixture()
        server=make_server('127.0.0.1',0,create_wsgi_app(service),handler_class=QuietHandler)
        thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
        try:
            url='http://127.0.0.1:'+str(server.server_port)+'/v1/policy/evaluate'
            with urllib.request.urlopen(urllib.request.Request(url,data=request['body'],headers=dict(request['headers'])),timeout=5) as response:
                self.assertEqual(json.load(response)['decision'],'deny')
            with self.assertRaises(urllib.error.HTTPError) as error:
                urllib.request.urlopen(urllib.request.Request(url,data=b'{bad'),timeout=5)
            self.assertEqual(error.exception.code,401)
            self.assertEqual(host.resolutions,1)
        finally:
            server.shutdown();server.server_close();thread.join(timeout=5)

    def test_mcp_lifecycle_and_revocation(self):
        service,_,host=fixture();server=McpServer(service,lambda:host.token)
        self.assertEqual(send(server,CALL)['error']['message'],'NOT_INITIALIZED')
        self.assertEqual(host.resolutions,0)
        self.assertEqual(send(server,INITIALIZE)['result']['protocolVersion'],'2025-11-25')
        self.assertEqual(send(server,LIST)['error']['message'],'NOT_INITIALIZED')
        self.assertIsNone(send(server,INITIALIZED))
        tools=send(server,LIST)['result']['tools'];self.assertEqual(len(tools),2)
        tools[0]['name']='mutated';self.assertEqual(send(server,LIST)['result']['tools'][0]['name'],'realflow.security.verify')
        result=send(server,CALL)['result'];self.assertEqual(json.loads(result['content'][0]['text']),result['structuredContent'])
        self.assertEqual(result['structuredContent']['decision'],'deny')
        self.assertIsNone(send(server,{'jsonrpc':'2.0','method':'tools/call','params':CALL['params']}));self.assertEqual(host.resolutions,1)
        host.token='invalid';self.assertEqual(send(server,CALL)['error']['message'],'UNAUTHENTICATED')
        host.token='public-tenant-b';self.assertEqual(send(server,CALL)['error']['message'],'IDENTITY_CHANGED');self.assertEqual(host.resolutions,1)

    def test_mcp_validation_and_unsupported_tools(self):
        service,_,host=fixture();server=McpServer(service,lambda:host.token)
        send(server,INITIALIZE);send(server,INITIALIZED)
        self.assertEqual(send(server,{**CALL,'params':{'name':'realflow.security.decrypt','arguments':{}}})['error']['code'],-32602)
        self.assertEqual(send(server,{**CALL,'params':{**CALL['params'],'arguments':{'operation_id':'op-1','checks':{'trusted':True}}}})['error']['code'],-32602)
        self.assertEqual(server.handle('{"jsonrpc":"2.0","id":1,"id":2,"method":"ping"}')['error']['code'],-32700)
        for value in ([],{'jsonrpc':'2.0','id':None,'method':'ping'}):
            self.assertEqual(send(server,value)['error']['code'],-32600)
        self.assertEqual(send(server,{**LIST,'params':None})['error']['code'],-32602);self.assertEqual(host.resolutions,0)

    def test_stdio_round_trip_and_bounds(self):
        service,_,host=fixture();server=McpServer(service,lambda:host.token)
        wire=('\n'.join(json.dumps(v) for v in [INITIALIZE,INITIALIZED,LIST,CALL])+'\n').encode('utf-8')
        output=io.BytesIO();serve_stdio(server,io.BytesIO(wire),output)
        replies=[json.loads(line) for line in output.getvalue().splitlines()]
        self.assertEqual(len(replies),3);self.assertEqual(replies[-1]['result']['structuredContent']['decision'],'deny')
        for wire,reason in [(b'{}','TRUNCATED_FRAME'),(b'x'*(MAX_REQUEST_BYTES+1)+b'\n','FRAME_TOO_LARGE')]:
            with self.assertRaisesRegex(ValueError,reason): serve_stdio(server,io.BytesIO(wire),io.BytesIO())

    def test_mcp_verifies_same_codec(self):
        service,_,host=fixture();server=McpServer(service,lambda:host.token)
        send(server,INITIALIZE);send(server,INITIALIZED)
        request=next(c['request'] for c in SUITE['httpCases'] if c['id']=='verify-valid')
        result=send(server,{**CALL,'params':{'name':'realflow.security.verify','arguments':request}})
        self.assertEqual(result['result']['structuredContent']['summary']['valid'],1)

    def test_mcp_metadata_cannot_elevate_scope(self):
        service,_,host=fixture();host.token='public-no-scope';server=McpServer(service,lambda:host.token)
        send(server,INITIALIZE);send(server,{**INITIALIZED,'params':{'_meta':{}}})
        meta={'scopes':['policy:evaluate'],'tenantId':'tenant-a','progressToken':123}
        self.assertEqual(send(server,{**LIST,'params':{'_meta':meta}})['result']['tools'],[])
        result=send(server,{**CALL,'params':{**CALL['params'],'_meta':meta}})['result']
        self.assertTrue(result['isError']);self.assertEqual(json.loads(result['content'][0]['text'])['error']['code'],'FORBIDDEN');self.assertEqual(host.resolutions,0)

if __name__=='__main__': unittest.main()
