# SPDX-License-Identifier: Apache-2.0
import os
import sys
import threading
from pathlib import Path
from psp_cdl_mcp_server import McpServer
from psp_cdl_mcp_server.stdio import serve_stdio
from psp_cdl_mcpproxy import McpDispatchGate
from psp_cdl_mcpproxy.mcp import StdioMcpClient, create_mcp_proxy_service
from dispatch_fixtures import Fixture
from topology_common import case_by_id, approval, environment, EventLog, close_approval
from fixture_isolation import isolate

case_id, executable, script, server_spy, proxy_spy = sys.argv[1:]
case = case_by_id(case_id)
log = EventLog(proxy_spy,case_id)
peer = f = None
timer = threading.Timer(30,lambda:os._exit(2))
timer.daemon = True
timer.start()
closed = False
try:
    f = Fixture({'agents':'mcp://reference/allowed','temporaryRoot':str(Path(proxy_spy).parent)})
    peer = StdioMcpClient.connect({'executable':executable,'args':[script,'C',case_id,server_spy],'env':environment(),
        'serverInfo':{'name':'psp-cdl-reference','version':'0.1.0'},'timeoutMs':4000})
    registrations = peer.registrations('reference',[approval(name,['used-for-model-training'] if case['input']['perturbation'] == 'proxy-policy-denial' else []) for name in ('allowed','other')],f.now)
    gate = McpDispatchGate(f.store,f,'registry-1',registrations)
    service = create_mcp_proxy_service(gate,f.session['sessionId'],lambda:f.options)
    control = peer.registrations('fixture-control',[close_approval()],f.now)[0]
    def shutdown():
        global closed, peer, f
        if not closed:
            if not Path(server_spy+'.closed').exists(): control['invoke']({},f.options)
            closed = True
            peer.close()
            peer = None
            f.close()
            f = None
            log.close()
            threading.Timer(1,lambda:os._exit(0)).start()

    class Wrapped:
        def authenticate(self, token): return service.authenticate(token)
        def discover(self, *_): return [{k:r[k] for k in ('name','inputSchema','outputSchema')} for r in registrations] + [close_approval()]
        def call_tool(self, name, args, token, principal):
            global closed, peer, f
            if name == 'fixture_close' and args == {}:
                shutdown()
                return {'data':{'closed':True}}
            log.write('proxy-dispatch',args.get('recordId'))
            try:
                result = service.call_tool('reference.'+name,args,token,principal)
                log.write('proxy-release',args['recordId'],'ALLOW')
                return result
            except Exception as exc:
                log.write('proxy-denied',args.get('recordId'),getattr(exc,'code','INTERNAL_ERROR'))
                shutdown()
                raise
    isolate()
    log.write('isolation-probes-blocked')
    serve_stdio(McpServer(Wrapped(),lambda:'test-owner'))
finally:
    timer.cancel()
    try:
        if peer: peer.close()
    finally:
        if f: f.close()
        if not closed: log.close()
