# HTTP API contracts

RFC-PSP-API was not supplied. Draft a reviewed OpenAPI contract here in M3 for sessions, nodes, checkpoints, policy decisions and security operations. Define authentication, tenancy, idempotency, error models, pagination and API versioning before implementation. Do not infer endpoints from the SaaS.

[Security service OpenAPI 0.1](security-0.1.openapi.json) now specifies the implemented read-only verification and policy endpoints. It remains a project draft; host authentication, tenant/subject binding, bounded transport handling and authoritative operation snapshots are required beyond structural schema validation. Stateful endpoints are deferred.
