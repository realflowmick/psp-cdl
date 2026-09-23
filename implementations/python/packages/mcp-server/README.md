# psp-cdl-mcp-server

Status: **experimental reusable library**. Implements the first read-only authenticated security service slice. HTTP and MCP stdio share the service layer and core/CDL libraries; no listener, credentials or SaaS connection is created on import.

See the [service API guide](../../../../docs/service-api.md), [workflow API](../../../../docs/workflow-api.md) and [roadmap](../../../../ROADMAP.md). Supply `SecurityService` for read-only tools or `WorkflowService` for six additional authenticated session/node/checkpoint tools. Discovery is scope filtered and calls use host authorization. Resume credentials stay outside tool arguments/results. Remaining M3 tools, decryption and full workflow execution remain unsupported. Package publication is disabled pending release review.

License: Apache-2.0. Founding sponsor: RealflowCloud, Inc.

`McpServer` also accepts a trusted tool-service object with `authenticate`, `discover` and `call_tool` callbacks. Calls return `{"data": object, "meta": optional_object}`; the dispatcher regenerates text and structured content. This interface supplies framing/lifecycle only. Use the [MCPProxy adapter](../../../../docs/mcp-stdio.md) to put the gate in that path; arbitrary host callbacks do not acquire CDL enforcement automatically. Stdio input and serialized output are bounded to 1 MiB per frame.

The opt-in [Streamable HTTP adapter](../../../../docs/mcp-http.md) adds host-authenticated resource access, bounded owner sessions, verified downstream TLS and cancellation. It consumes host-obtained tokens and buffers finite JSON/SSE responses; OAuth client flows and production hosting remain host integrations.
