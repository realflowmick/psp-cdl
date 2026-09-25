# SPDX-License-Identifier: Apache-2.0
from lifecycle_fixtures import Fixture
from psp_cdl_mcp_server import McpServer
from psp_cdl_mcp_server.stdio import serve_stdio
f = Fixture()
try:
    serve_stdio(McpServer(f.service,lambda:"test-owner"))
finally:
    f.close()
