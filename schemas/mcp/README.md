# MCP contracts

The baseline tool inventory is PSP §22.5.2: `realflow.sessions.create`, `realflow.sessions.get`, `realflow.sessions.update`, `realflow.sessions.list`, `realflow.nodes.fetch`, `realflow.checkpoints.create`, `realflow.checkpoints.resume`, `realflow.security.verify`, `realflow.security.decrypt`, `realflow.security.scan`, and `realflow.security.process`.

M3 will define complete input/output schemas and transport/authentication behavior, pinned to a supported MCP revision. The `realflow` namespace is inherited from the RFC and does not require a commercial service. Unimplemented operations must return an explicit unsupported error before side effects.

[Security tool contracts 0.1](security-tools-0.1.json) now describe the implemented `realflow.security.verify` and extension `realflow.policy.evaluate` tools over MCP 2025-11-25 stdio. Only these tools are advertised, filtered by scope. Sessions, nodes, checkpoints, scan/decrypt/process and MCP Streamable HTTP remain unsupported. See the [service profile](../../specs/profiles/PSP-SERVICE-0.1.md).
