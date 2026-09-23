# SPDX-License-Identifier: Apache-2.0
import json
import os
import sys
import threading
from http.server import ThreadingHTTPServer
from psp_cdl_mcp_server import McpServer
from psp_cdl_mcp_server.stdio import serve_stdio
from psp_cdl_mcp_server.http import McpHttpServer,make_http_handler
from mcp_refresh_fixtures import TestPeer,PRINCIPAL
from http_fixtures import config
c=json.loads(sys.argv[1]);peer=TestPeer(c.get("mode","normal"));call=peer.call_tool
def counted(*args):
    with open(c["spy"],"a",encoding="utf-8") as stream:stream.write("call\n")
    return call(*args)
def authenticate(token):
    if token!="synthetic-refresh-token":raise ValueError("DENIED")
    return PRINCIPAL
peer.call_tool=counted;peer.authenticate=authenticate
if c["transport"]=="stdio":serve_stdio(McpServer(peer,lambda:os.environ.get("PSP_REFRESH_TOKEN","")))
else:
    server=ThreadingHTTPServer(("127.0.0.1",0),make_http_handler(None))
    endpoint=f"http://127.0.0.1:{server.server_port}/mcp"
    class Host:
        def authenticate(self,t,r):return PRINCIPAL if t=="synthetic-refresh-token" and r==endpoint else None
        def open(self,*_):return {"service":peer,"close":lambda:None}
    adapter=McpHttpServer(Host(),config(endpoint));server.RequestHandlerClass=make_http_handler(adapter)
    thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
    print(endpoint,flush=True)
    sys.stdin.read();adapter.close();server.shutdown();server.server_close();thread.join()
