# SPDX-License-Identifier: Apache-2.0
"""Synthetic process fixture, not a public administration service."""
import json
import sys
import threading
from types import SimpleNamespace
from http.server import ThreadingHTTPServer
from psp_cdl_mcp_server import McpServer
from psp_cdl_mcp_server.stdio import serve_stdio
from psp_cdl_mcp_server.http import McpHttpServer, make_http_handler
from revision_fixtures import RevisionPeer, PRINCIPAL
from http_fixtures import config
c=json.loads(sys.argv[1])
def spy():
    with open(c["spy"],"a",encoding="utf-8") as out: out.write("call\n")
p=RevisionPeer(c.get("mode","ok"),spy,c.get("revision","tool-1"))
if c["transport"]=="stdio": serve_stdio(McpServer(p.service(),lambda:"test-downstream"))
else:
    server=ThreadingHTTPServer(("127.0.0.1",0),make_http_handler(None))
    endpoint=f"http://127.0.0.1:{server.server_port}/mcp"
    host=SimpleNamespace(authenticate=lambda t,r:PRINCIPAL if t=="test-downstream" and r==endpoint else None,open=lambda _p,cancelled:{"service":p.service(cancelled),"close":lambda:None})
    adapter=McpHttpServer(host,config(endpoint))
    server.RequestHandlerClass=make_http_handler(adapter)
    worker=threading.Thread(target=server.serve_forever,daemon=True);worker.start()
    print(endpoint,flush=True)
    try: sys.stdin.read()
    finally: adapter.close();server.shutdown();server.server_close()
