# psp-cdl-api-server

Status: **experimental reusable library**. Implements the first read-only authenticated security service slice. HTTP and MCP stdio share the service layer and core/CDL libraries; no listener, credentials or SaaS connection is created on import.

See the [service API guide](../../../../docs/service-api.md), [workflow API](../../../../docs/workflow-api.md) and [roadmap](../../../../ROADMAP.md). Explicit `workflow` and `operations` submodules add opt-in authenticated workflow methods and session-bound security-operation handles. Hosts supply validated credentials, transition authorization, policy revisions and permitted output views. `persistence` and `sqlite` provide the [durable host library](../../../../docs/persistence.md), using one SQLite connection per serving worker. Remaining M3 tools, decryption and full workflow execution remain unsupported. Package publication is disabled pending release review.

License: Apache-2.0. Founding sponsor: RealflowCloud, Inc.
