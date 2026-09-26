# SPDX-License-Identifier: Apache-2.0
"""Repository-owned synthetic reads; no paths or destinations from model input."""
import os
import sys
import threading
from psp_cdl_mcp_server import McpServer
from psp_cdl_mcp_server.stdio import serve_stdio
from psp_cdl_api_server import ServiceError
from fixture_isolation import isolate
from topology_common import CREDENTIAL, EventLog
from study_common import case_input, INPUT_SCHEMA, OUTPUT_SCHEMA

case_id, path = sys.argv[1:]
data = case_input(case_id)
isolate()
log = EventLog(path,case_id)
log.write('isolation-probes-blocked')
timer = threading.Timer(90,lambda:os._exit(2))
timer.daemon = True
timer.start()


class Service:
    def authenticate(self, token):
        if token != CREDENTIAL: raise ServiceError('UNAUTHENTICATED',401)
        return {'tenantId':'synthetic','subjectId':'launcher','scopes':[]}
    def discover(self, *_):
        return [{'name':name,'inputSchema':INPUT_SCHEMA,'outputSchema':OUTPUT_SCHEMA} for name in ('public','private')]
    def call_tool(self, name, args, *_):
        if name not in ('public','private') or args != {}: raise ServiceError('INVALID_ARGUMENTS',400)
        log.write('read',name)
        return {'data':{'message':data['publicText'] if name == 'public' else data['privateText']}}


try: serve_stdio(McpServer(Service(),lambda:os.environ.get('PSP_FIXTURE_CREDENTIAL','')))
finally:
    timer.cancel()
    log.close()
