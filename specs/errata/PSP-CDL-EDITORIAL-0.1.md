# API reference and editorial corrections 0.1

Status: **draft proposal**, 2026-09-24. CC0-1.0. No published RFC is modified.

The later [API/editorial candidate 0.2](PSP-API-EDITORIAL-0.2.md) selects a new
normative API proposal instead of the reference-deletion option below. This
document remains the historical proposal; neither option is adopted yet.

## PSP-E006: absent normative API

PSP Core 3.2.0 line 116, under Scope, refers to `RFC-PSP-API`. No such supplied
normative document exists. The archived PSP 3.1.1 contains the same absent
reference and remains an immutable historical artifact.

Proposed resolution: in a **future version** replace that reference with:

> Network protocols and API design are outside this core specification.
> Project reference implementations publish separately versioned experimental
> API profiles; no normative RFC-PSP-API is supplied by this revision.

This is a versioned reference correction, not retrospective invention of an
API standard. [Security 0.1](../profiles/PSP-SERVICE-0.1.md) and
[Workflow 0.1](../profiles/PSP-WORKFLOW-SERVICE-0.1.md) remain opt-in drafts.
The proposal does not remove §22.5.2 obligations. If a normative API is desired,
it requires a separately reviewed document defining wire formats, authority,
errors, lifecycle, compatibility and all missing operations.

## All eleven required MCP tools

The mapping is from PSP 3.2.0 §22.5.2, not from the number of implemented routes.
The machine-readable [review map](api-editorial-0.1.json) is checked against
the frozen source and current OpenAPI paths.

| Required tool | Draft mapping or explicit gap |
| --- | --- |
| realflow.sessions.create | Workflow 0.1 POST /v1/sessions/create |
| realflow.sessions.get | Workflow 0.1 POST /v1/sessions/get |
| realflow.sessions.update | Workflow 0.1 POST /v1/sessions/update |
| realflow.sessions.list | Lifecycle 0.1 POST /v1/sessions/list; paired HTTP/stdio evidence in scripts/check-lifecycle-parity.py |
| realflow.nodes.fetch | Workflow 0.1 POST /v1/nodes/fetch |
| realflow.checkpoints.create | Workflow 0.1 POST /v1/checkpoints/create |
| realflow.checkpoints.resume | Workflow 0.1 POST /v1/checkpoints/resume |
| realflow.security.verify | Security 0.1 POST /v1/security/verify |
| realflow.security.decrypt | Security Tools 0.1 POST /v1/security/decrypt; selected encrypt-then-sign AES-GCM contract |
| realflow.security.scan | Security Tools 0.1 POST /v1/security/scan; strict bounded diagnostics |
| realflow.security.process | Security Tools 0.1 POST /v1/security/process; buffered all-or-nothing content release |

All eleven tool names have draft counterparts. `scripts/check-security-tools-parity.py`
exercises each over actual HTTP/MCP stdio in both language directions. Name matching
does not prove wire compatibility. Workflow drafts use camelCase, host-scoped
projected data and private checkpoint handoff; RFC examples use snake_case,
full workflow state and model-visible resume tokens/links. Security verification
requires a host-issued operation binding and bounded batches. Those differences
need explicit future compatibility/migration decisions. Existing implementation
tests prove their draft contracts only. `realflow.policy.evaluate` and the
optional `realflow.security.refresh` extension are additional tools and must not
be counted toward the eleven.

## DOC-E001: exact heading corrections

The review map records source path/line/old/new for each correction:

* PSP `21.5.4 Checkpoint Operations` → `22.5.4 Checkpoint Operations`.
* PSP `21.5.5 Security Operations` → `22.5.5 Security Operations`.
* CDL RBAC children `12.2` through `12.10` → `11.2` through `11.10`.

These eleven edits are editorial proposals for a new version. They change no
technical behavior. Historical links/anchors must keep an alias map to the old
version. Do not globally replace `12.x`: CDL's actual §12 has unrelated headings
with those numbers. Cross-references must use the heading name plus version
where numbering is ambiguous; ambiguous references require author disposition.

## Parser review errata

PSP-E007 proposes making §6.3's raw-text description explicitly subordinate to
the selected codec's structural nested openers and escaping, and documenting
bounded nesting. PSP-E008 proposes replacing §24's alias-precedence rule with
rejection of mixed/duplicate pairs as already required by Signature 2.0.
PSP-E009 proposes replacing §24's original-version mandate with compatible,
monotonic version approval, and removing permission to continue an expired
node. These are **normative proposals**, not editorial changes or accepted
amendments. Existing profiles and fail-closed runtime behavior remain unchanged.

Decision register: existing profile errata remain as recorded; this proposal's
acceptance, public review dates, comment dispositions and migration revision
are **pending maintainer review**. The minimum 14-day public-comment requirement
in [GOVERNANCE](../../GOVERNANCE.md) applies before normative adoption.

The [security tools draft](../profiles/PSP-SECURITY-TOOLS-0.1.md) records #38
encryption and release choices plus explicit unsupported cases. Tool-name
coverage does not adopt the absent normative API or complete M3.
