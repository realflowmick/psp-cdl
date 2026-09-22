# SPDX-License-Identifier: Apache-2.0
"""Complete adapter parity plus real mixed-language HTTP and MCP stdio connections."""
import json
import subprocess
import sys
import threading
import urllib.request
import urllib.error
from pathlib import Path
from wsgiref.simple_server import make_server, WSGIRequestHandler
from service_fixtures import fixture, SUITE
from psp_cdl_api_server.http import handle_http, create_wsgi_app
from psp_cdl_mcp_server import McpServer
ROOT=Path(__file__).resolve().parents[1]
def run(args,**kwargs):
    return subprocess.run(args,cwd=ROOT,check=True,capture_output=True,text=True,encoding='utf-8',timeout=30,**kwargs).stdout
peer=json.loads(run(['node','scripts/service-probe.mjs','--report']))
http=[]
for case in SUITE['httpCases']:
    service,request,_=fixture(case);result=handle_http(service,request)
    http.append({'id':case['id'],'status':result['status'],'body':json.loads(result['body'])})
assert http==peer['http']
service,_,host=fixture();server=McpServer(service,lambda:host.token)
mcp=[reply for message in peer['messages'] if (reply:=server.handle(json.dumps(message,ensure_ascii=False))) is not None]
assert mcp==peer['mcp']
wire='\n'.join(json.dumps(message,ensure_ascii=False) for message in peer['messages'])+'\n'
assert [json.loads(line) for line in run(['node','scripts/service-probe.mjs','--stdio'],input=wire).splitlines()]==mcp
print(run(['node','scripts/service-probe.mjs','--python-stdio',sys.executable]).strip())
class QuietHandler(WSGIRequestHandler):
    def log_message(self,*args): pass
    def setup(self):
        super().setup();self.connection.settimeout(5)
http_server=make_server('127.0.0.1',0,create_wsgi_app(service),handler_class=QuietHandler)
thread=threading.Thread(target=http_server.serve_forever,daemon=True);thread.start()
try:
    print(run(['node','scripts/service-probe.mjs','--http-client','http://127.0.0.1:'+str(http_server.server_port)]).strip())
finally:
    http_server.shutdown();http_server.server_close();thread.join(timeout=5)
process=subprocess.Popen(['node','scripts/service-probe.mjs','--http-server'],cwd=ROOT,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,encoding='utf-8')
try:
    port=int(process.stdout.readline())
    for case in SUITE['httpCases']:
        if case['id'] not in ('policy-deny','verify-valid','no-auth','cross-tenant','forged-checks'): continue
        _,request,_=fixture(case)
        req=urllib.request.Request('http://127.0.0.1:'+str(port)+request['path'],data=request['body'],headers=dict(request['headers']),method=request['method'])
        try: response=urllib.request.urlopen(req,timeout=5)
        except urllib.error.HTTPError as error: response=error
        with response: assert {'status':response.status,'body':json.load(response)}==case['expected']
finally:
    process.communicate(timeout=10)
    assert process.returncode==0
print(str(len(http))+' HTTP cases and MCP transcripts agree; both real HTTP and stdio interchange directions passed.')
