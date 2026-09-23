# mcpproxy

MCP mediation, node-agent affinity, covenant checks, and provenance.

Status: **experimental host-embedded dispatch gate**, the first M4 slice. `McpDispatchGate` supplies exact node affinity, host-authenticated registrations, namespaced read-only dispatch, deterministic CDL input/output checks and level-5 output provenance. It requires a coordinated workflow store and trusted host callbacks. See [the integration guide](../../../../docs/mcp-dispatch.md). Network MCP mediation, mutating tools and durable dispatch recovery remain unsupported. The whole-workflow guard raises NOT_IMPLEMENTED. Package publication is disabled.

License: Apache-2.0. Founding sponsor: RealflowCloud, Inc.

The explicit `@psp-cdl/mcpproxy/mcp` entry point adds `StdioMcpClient`, `createMcpProxy` and `serveStdio`. It supports launcher-authenticated local mediation with pinned discovery and checked structured responses. See [the stdio guide](../../../../docs/mcp-stdio.md) for approvals, process cleanup, deadlines and unsupported wire-level cancellation. Remote HTTP/OAuth remains pending.
