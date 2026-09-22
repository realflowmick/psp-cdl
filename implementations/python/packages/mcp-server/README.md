# psp-cdl-mcp-server

Status: **experimental reusable library**. Implements the first read-only authenticated security service slice. HTTP and MCP stdio share the service layer and core/CDL libraries; no listener, credentials or SaaS connection is created on import.

See the [service API guide](../../../../docs/service-api.md), [workflow API](../../../../docs/workflow-api.md) and [roadmap](../../../../ROADMAP.md). Supply `SecurityService` for read-only tools or `WorkflowService` for six additional authenticated session/node/checkpoint tools. Discovery is scope filtered and calls use host authorization. Resume credentials stay outside tool arguments/results. Remaining M3 tools, decryption and full workflow execution remain unsupported. Package publication is disabled pending release review.

License: Apache-2.0. Founding sponsor: RealflowCloud, Inc.
