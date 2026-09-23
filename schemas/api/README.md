# HTTP API contracts

RFC-PSP-API was not supplied. Draft a reviewed OpenAPI contract here in M3 for sessions, nodes, checkpoints, policy decisions and security operations. Define authentication, tenancy, idempotency, error models, pagination and API versioning before implementation. Do not infer endpoints from the SaaS.

[Security service OpenAPI 0.1](security-0.1.openapi.json) specifies the implemented read-only verification and policy endpoints. [Workflow service OpenAPI 0.1](workflow-0.1.openapi.json) adds six opt-in authenticated session/node/checkpoint methods. Both remain project drafts; host authentication, tenant/subject binding, authorization, bounded transport handling and authoritative operation snapshots are required beyond structural schema validation. Listing/cancellation/retention and remaining security tools are deferred.
