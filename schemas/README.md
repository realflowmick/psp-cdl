# Shared contracts

The component, vector and result schemas describe repository metadata and test artifacts. They are versioned **project draft contracts**, not claims of complete RFC grammar or API conformance. Every contract change must be tested in both language workspaces. The future HTTP OpenAPI and MCP method contracts belong in `api/` and `mcp/` when M3 starts.

The PSP signature envelope 2.0 schema is a normative structural companion to PSP Core 3.2.0. It does not by itself verify signatures, key authority, time intervals, duplicate-name handling, or scope; those are required by the signature profile.

The `cdl-policy-table-1.0`, `psp-enforcement-table-1.0` and `policy-vectors-1.0` schemas validate profile tables and synthetic decision fixtures. They are not service input schemas. They cannot establish trusted provenance, capability honesty, scoped negation authority or successful safeguard execution. Profile rules remain normative beyond structural validation; see [the policy fixture interface](../conformance/policy/README.md).

The [PSP document 1.0 schema](psp-document-1.0.schema.json) describes the normalized reusable codec tree. It requires a wire profile identifier; builders may default it before serialization. Structural validation does not check source-hint equivalence, aggregate byte/depth limits, authority or signatures. Both language libraries perform their runtime checks independently.
