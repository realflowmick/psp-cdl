# ADR 0001: Shared standards and paired language workspaces

Status: accepted for project scaffolding.

Use one repository with versioned RFC documents, language-neutral schemas/vectors, npm and uv workspaces, and seven paired components. This makes changes to normative interpretation visible to both implementations and avoids duplicating expected results. Each component remains independently packageable.

Use CC0 for standards/schema/vector data and Apache-2.0 for reference software and general documentation. Preserve original RFC technical text while tracking errata. Keep packages private and fail closed at unimplemented boundaries. Bootstrap checks must not imply conformance.

Tradeoffs: one repository couples CI and governance, while independent package versioning still needs release tooling. A shared vector corpus improves consistency but may encode a common mistaken interpretation; independent review and adversarial cases remain necessary.
