# HTTP API contracts

RFC-PSP-API was not supplied with the historical Core revisions. The [API 1.0.0 candidate](../../specs/api/RFC-PSP-API-v1_0_0-candidate.md) now proposes a new separately versioned normative API. It remains unadopted until public review and a recorded maintainer decision. Do not infer endpoints from the SaaS.

[Security service OpenAPI 0.1](security-0.1.openapi.json) specifies read-only verification and policy endpoints. [Workflow 0.1](workflow-0.1.openapi.json) adds six session/node/checkpoint methods, [Lifecycle 0.1](lifecycle-0.1.openapi.json) adds listing/cancellation/retention, and [Security Tools 0.1](security-tools-0.1.openapi.json) adds scan/decrypt/process. These are existing implementation drafts; host authentication, tenant/subject binding, authorization, bounded transport handling and authoritative operation snapshots are required beyond schema validation.

The [combined candidate](psp-api-1.0.0-candidate.openapi.json) references those exact schemas and identifies eleven required operations plus three optional extensions. Its [contract index](../../specs/api/contract-set-1.0.0.json) pins their hashes and records compatibility evidence. Generating this bundle does not alter the source contracts or adopt the API.
