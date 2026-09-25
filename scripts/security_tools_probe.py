# SPDX-License-Identifier: Apache-2.0
from security_tools_fixtures import CombinedFixture as Fixture
from psp_cdl_mcp_server import McpServer
from psp_cdl_mcp_server.stdio import serve_stdio
f = Fixture()
try:
    serve_stdio(McpServer(f.service,lambda:"test-owner"))
finally:
    f.close()
