# MCP contracts

The baseline tool inventory is PSP §22.5.2: `realflow.sessions.create`, `realflow.sessions.get`, `realflow.sessions.update`, `realflow.sessions.list`, `realflow.nodes.fetch`, `realflow.checkpoints.create`, `realflow.checkpoints.resume`, `realflow.security.verify`, `realflow.security.decrypt`, `realflow.security.scan`, and `realflow.security.process`.

M3 will define complete input/output schemas and transport/authentication behavior, pinned to a supported MCP revision. The `realflow` namespace is inherited from the RFC and does not require a commercial service. Unimplemented operations must return an explicit unsupported error before side effects.
