# mcpproxy

MCP mediation, node-agent affinity, covenant checks, and provenance.

Status: **experimental host-embedded dispatch gate**, the first M4 slice. `McpDispatchGate` supplies exact node affinity, host-authenticated registrations, namespaced read-only dispatch, deterministic CDL input/output checks and level-5 output provenance. It requires a coordinated workflow store and trusted host callbacks. See [the integration guide](../../../../docs/mcp-dispatch.md). Mutating tools and durable dispatch recovery remain unsupported. The whole-workflow guard raises NOT_IMPLEMENTED. Package publication is disabled.

License: Apache-2.0. Founding sponsor: RealflowCloud, Inc.

The explicit `psp_cdl_mcpproxy.mcp` module adds `StdioMcpClient`, `create_mcp_proxy` and `serve_stdio`. It supports launcher-authenticated local mediation with pinned discovery and checked structured responses. See [the stdio guide](../../../../docs/mcp-stdio.md) for approvals, process cleanup, deadlines and unsupported wire-level cancellation. HTTP support is described below; OAuth client flows remain host integrations.

The opt-in [Streamable HTTP adapter](../../../../docs/mcp-http.md) adds host-authenticated resource access, bounded owner sessions, verified downstream TLS and cancellation. It consumes host-obtained tokens and buffers finite JSON/SSE responses; OAuth client flows and production hosting remain host integrations.
