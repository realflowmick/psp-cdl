# SPDX-License-Identifier: Apache-2.0
from copy import deepcopy
from .server import McpServer, MCP_VERSION
_MANIFEST = {'id': 'mcp-server', 'status': 'experimental', 'specifications': {'psp': '3.2.0', 'cdl': '1.5'}, 'implementedFeatures': ['mcp-security-tools-0.1', 'mcp-stdio-2025-11-25', 'mcp-workflow-tools-0.1', 'host-tool-service-adapter', 'mcp-streamable-http-0.1', 'mcp-revision-0.1']}
def get_manifest(): return deepcopy(_MANIFEST)
class NotImplementedFeatureError(NotImplementedError):
    code="NOT_IMPLEMENTED"
def require_implementation():
    raise NotImplementedFeatureError("Complete workflow services are not implemented.")
