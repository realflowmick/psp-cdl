# Examples

The topology manifests describe future reproducible scenarios, not deployable services. They use synthetic data and local mock providers. A means semantic-only enforcement; B includes an authoritative chat-host/LLMProxy tool-dispatch loop; C also includes MCPProxy and a CDL-aware server. The separate [offline workflow matrix](../docs/workflow-matrix.md) now provides executable A/B/C fixtures in every host/proxy/server language combination. These scripted-provider checks do not make the scenario manifests deployable or measure semantic model behavior.

The [authenticated workflow example](workflow/README.md) is executable now in TypeScript/Node and Python. It uses the reusable store and HTTP adapter for create, save, checkpoint, host-approved resume and retry with disposable synthetic data. It does not implement the full topology manifests.
