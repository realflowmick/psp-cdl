# MCP contracts

The baseline tool inventory is PSP §22.5.2: `realflow.sessions.create`, `realflow.sessions.get`, `realflow.sessions.update`, `realflow.sessions.list`, `realflow.nodes.fetch`, `realflow.checkpoints.create`, `realflow.checkpoints.resume`, `realflow.security.verify`, `realflow.security.decrypt`, `realflow.security.scan`, and `realflow.security.process`.

M3 will define complete input/output schemas and transport/authentication behavior, pinned to a supported MCP revision. The `realflow` namespace is inherited from the RFC and does not require a commercial service. Unimplemented operations must return an explicit unsupported error before side effects.

[Security tool contracts 0.1](security-tools-0.1.json) describe `realflow.security.verify` and extension `realflow.policy.evaluate` over MCP 2025-11-25 stdio. The opt-in [workflow tool contracts](workflow-tools-0.1.json) add six session/node/checkpoint methods through `WorkflowService`. Discovery is filtered by enabled service and scope. Listing/cancellation/retention, scan/decrypt/process and MCP Streamable HTTP remain unsupported. See the [service profile](../../specs/profiles/PSP-SERVICE-0.1.md) and [workflow service profile](../../specs/profiles/PSP-WORKFLOW-SERVICE-0.1.md).
