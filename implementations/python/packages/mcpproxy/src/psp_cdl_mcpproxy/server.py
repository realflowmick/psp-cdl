# SPDX-License-Identifier: Apache-2.0
"""One launcher-authenticated caller/session per MCP connection."""
from psp_cdl_mcp_server import McpServer
from psp_cdl_api_server import ServiceError
from .dispatch import DispatchError


def create_mcp_proxy(gate, credential, session_id, controls):
    def protect(work):
        try: return work()
        except DispatchError as exc: raise ServiceError(exc.code,400 if exc.code in ("INVALID_REQUEST","INVALID_ARGUMENTS") else 403) from None
    class Tools:
        def authenticate(self, token): return gate.authenticate(token)
        def discover(self, token, principal): return protect(lambda:gate.list_tools(token,session_id,controls(),principal))
        def call_tool(self, name, args, token, principal):
            def call():
                result = gate.call_tool(token,session_id,{"name":name,"arguments":args},controls(),principal)
                return {"data":result["data"],"meta":{"psp-cdl/provenance":result["provenance"]}}
            return protect(call)
    return McpServer(Tools(),credential)
