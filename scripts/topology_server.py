# SPDX-License-Identifier: Apache-2.0
"""Governed synthetic server; no policy, identity or capability facts come from tool arguments."""
import os
import sys
import threading
from pathlib import Path
from psp_cdl_mcp_server import McpServer
from psp_cdl_mcp_server.stdio import serve_stdio
from psp_cdl_api_server import ServiceError
from psp_cdl_cdl import evaluate_policy
from fixture_isolation import isolate
from topology_common import RECORDS, CREDENTIAL, case_by_id, resource, EventLog, close_approval

topology, case_id, path = sys.argv[1:]
case = case_by_id(case_id)
if topology not in ('A','B','C'): raise ValueError('INVALID_TOPOLOGY')
isolate()
log = EventLog(path,case_id)
log.write('isolation-probes-blocked')
timer = threading.Timer(30,lambda:os._exit(2))
timer.daemon = True
timer.start()
closed = False


def shutdown():
    global closed
    if not closed:
        closed = True
        log.close()
        Path(path+'.closed').write_text('closed',encoding='utf-8')
        threading.Timer(1,lambda:os._exit(0)).start()


class Service:
    def authenticate(self, token):
        if token != CREDENTIAL: raise ServiceError('UNAUTHENTICATED',401)
        return {'tenantId':'synthetic','subjectId':'launcher','scopes':[]}
    def discover(self, *_):
        return [{'name':name,'inputSchema':RECORDS['inputSchema'],'outputSchema':RECORDS['outputSchema']} for name in ('allowed','other','export')] + [close_approval()]
    def call_tool(self, name, args, *_):
        global closed
        if name == 'fixture_close' and args == {}:
            shutdown()
            return {'data':{'closed':True}}
        if closed: raise ServiceError('FIXTURE_CLOSED',403)
        if name not in ('allowed','other','export') or set(args) != {'recordId'} or args['recordId'] not in RECORDS['records']:
            raise ServiceError('INVALID_ARGUMENTS',400)
        log.write('export' if name == 'export' else 'read',args['recordId'])
        if topology == 'C':
            decision = evaluate_policy(resource(['no-training'],['used-for-model-training'] if case['input']['perturbation'] == 'server-output-denial' else []))
            log.write('server-output',args['recordId'],decision['decision'].upper())
            if decision['decision'] != 'allow':
                shutdown()
                raise ServiceError('OUTPUT_DENIED',403)
        return {'data':{'message':RECORDS['records'][args['recordId']]}}


try: serve_stdio(McpServer(Service(),lambda:os.environ.get('PSP_FIXTURE_CREDENTIAL','')))
finally:
    timer.cancel()
    if not closed: log.close()
    Path(path+'.closed').write_text('closed',encoding='utf-8')
