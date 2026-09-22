# SPDX-License-Identifier: Apache-2.0
"""Synthetic stdio peer for the Node interoperability client; no deployment secrets."""
from service_fixtures import fixture
from psp_cdl_mcp_server import McpServer
from psp_cdl_mcp_server.stdio import serve_stdio
service,_,host=fixture()
serve_stdio(McpServer(service,lambda:host.token))
