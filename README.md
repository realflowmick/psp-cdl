# PSP & CDL

Open standards and reference implementations for protecting LLM workflows, sponsored by **RealflowCloud, Inc.**

- **Prompt State Protocol (PSP)** describes signed prompt sections, workflow state, node/tool affinity, provenance, and session controls.
- **Covenant Declaration Language (CDL)** describes data classifications, handling constraints, and processing capabilities.

**Status: proposed standards; experimental reusable libraries.** TypeScript and Python implement PSP markup/object/JSON codecs, signatures and deterministic CDL policy evaluation. Reusable HTTP/MCP adapters expose authenticated security checks and opt-in workflow operations on durable SQLite sessions, nodes and single-use checkpoints. MCPProxy adds host-approved read-only dispatch, buffered output checks and bounded stdio and authenticated Streamable HTTP mediation. Hosts supply identity, transition approval and permitted data views. An opt-in buffered model/tool loop now checks host-signed prompts and governs inference, dispatch and final output. A separate durable loop adds atomic turns, host-approved completion, explicit lockdown and authorized recovery. An opt-in refresh loop adds host-approved expiration/interval refresh with durable counters and version continuity. OAuth client flows and remaining M3 tools are pending. Library tests establish scoped behavior, not production readiness, full protocol conformance or measured security effectiveness. This repository is independent of the sponsor's commercial SaaS; no RealflowCloud account is required.

## Standards

| Document | Version | Status |
| --- | --- | --- |
| [PSP Core](specs/psp/RFC-PSP-CORE-v3_2_0.md) | 3.2.0 | Proposed Standard |
| [CDL](specs/cdl/RFC-CDL-v1_5.md) | 1.5 | Proposed Standard |

The [3.1.1 baseline](specs/psp/RFC-PSP-CORE-v3_1_1.md) remains archived. The [signature profile](specs/profiles/PSP-SIGNATURE-2.0.md) resolves the initial signing ambiguities and has executable cross-language byte/crypto vectors. [CDL Deterministic Policy Profile 1.0](specs/profiles/CDL-DETERMINISTIC-1.0.md) defines finite matching rules, authorized negation and evidence requirements; [PSP Trust and Enforcement Profile 1.0](specs/profiles/PSP-TRUST-1.0.md) defines six trust levels and scoped topology guarantees. [PSP Codec Profile 1.0](specs/profiles/PSP-CODEC-1.0.md) defines reversible markup, document objects and signed nested-document transport. These proposed profiles require explicit adoption; full protocol implementations are still pending. See the [reusable library API](docs/library-api.md).

Read the [remaining specification issues](specs/errata/README.md) before implementing cryptography or claiming interoperability. RFC-PSP-API is referenced by PSP but was not supplied; local API contracts will be drafts until reviewed. These are project RFCs, not IETF or IANA approvals.

The [API 1.0.0 adoption candidate](specs/api/RFC-PSP-API-v1_0_0-candidate.md) now brings all eleven required tools, compatibility decisions and versioned editorial corrections into one review. Its [adoption record](specs/api/adoption-1.0.0.json) separates public comment from final acceptance. Existing wire contracts and published RFCs retain their current status.

## Repository map

```text
specs/                       RFCs, change process, errata, implementation profiles
schemas/                     Shared JSON Schema contracts
conformance/                 Requirements, vectors, and results format
implementations/
  typescript/packages/       npm workspace: seven reference components
  python/packages/           uv workspace: the same seven components
examples/                    Topology A/B/C scenario definitions
evaluation/                  Effectiveness study design and result templates
docs/                        Architecture, development, governance operations
deploy/                      Future local deployment and container assets
scripts/                     Repository validation and GitHub provisioning
.github/                     CI, ownership, issue forms, PR template
```

Both language workspaces contain `core`, `cdl`, `llmproxy`, `mcpproxy`, `mcp-server`, `api-server`, and `test-harness`. Their responsibilities and acceptance gates are in [architecture](docs/architecture.md) and the [implementation roadmap](ROADMAP.md).

## Get started

Use Node.js 24 LTS, Python 3.12+, and uv 0.10.4. CI also exercises Node.js 22 and Python 3.13. Commit both lockfiles when changing dependencies.

```sh
npm ci
npm run check
uv sync --locked --all-packages
uv run --locked python -m unittest discover -s implementations/python/tests -v
uv run --locked python scripts/check-parity.py
npm run conformance:inventory
npm run conformance:profiles
```

`npm run check` checks repository contracts, compiles all TypeScript packages, executes library tests and audits signature/policy fixtures. The profile harness runs 511 shared codec, signature, policy and trust checks through public library APIs. Parity checks exchange actual output in both directions. The inventory command lists the expanded RFC keyword/obligation register with explicit pending status; the five original workflow seed cases remain unexecuted; `npm run conformance` deliberately fails because full workflow adapters are pending. See [development](docs/development.md) for the detailed workflow.

## Participate

Start with [CONTRIBUTING](CONTRIBUTING.md), [GOVERNANCE](GOVERNANCE.md), [MAINTAINERS](MAINTAINERS.md), and [SECURITY](SECURITY.md). Specification changes, code changes, and empirical security claims each need appropriate evidence. The sponsor supports the project; sponsorship does not establish conformance or influence published evaluation outcomes.

## Licensing

The two standards, specification material, schemas, and shared conformance vectors are dedicated to the public domain under [CC0 1.0](LICENSES/CC0-1.0.txt). Reference code, tooling, tests, examples, and general documentation use [Apache-2.0](LICENSE). See [LICENSING](LICENSING.md) for exact path scopes and the recorded CDL license-notice change. Third-party names and standards retain their respective rights.

The [service API guide](docs/service-api.md) covers the first read-only M3 slice: shared host-authorized services, HTTP adapters and MCP stdio tools in both languages. The same core/CDL libraries handle parsing, signatures and decisions across these entry points.

The [persistence guide](docs/persistence.md) explains storage needs, SQLite/PostgreSQL options and the reusable host API. Both languages share one SQLite format and pass file/token interchange, restart and competing-update/resume tests. Storage adapters remain separate from public transports and host authentication.

The [workflow API](docs/workflow-api.md) adds six opt-in HTTP/MCP session, node and checkpoint methods, host transition authorization and session-bound operation handles. Run the [paired examples](examples/workflow/README.md) for create → save → pause → authenticated resume. 41 shared workflow scenarios and real HTTP/stdio mutations execute in both language directions. This is an embeddable reference layer; managed product operations and customer experience belong to the host.

The [MCP dispatch guide](docs/mcp-dispatch.md) covers the first M4 slice: namespaced local registrations, exact active-node affinity, CDL checks, bounded schemas, output provenance and optional process-local coordination shared with workflow writes. The [stdio mediation guide](docs/mcp-stdio.md) connects it to a launcher-authenticated caller and pinned downstream process, with real mixed-language chains and [paired examples](examples/mediation/README.md). The [HTTP mediation guide](docs/mcp-http.md) adds host-supplied resource tokens, verified TLS, buffered JSON/SSE and owner-scoped cancellation. OAuth client flows, mutating tools and durable dispatch recovery remain unsupported.

The [revision and refresh guide](docs/mcp-revision.md) adds an opt-in revision-aware receiving registry and explicitly approved replacement of an idle proxy gate. Both transports support the same preconditions; [paired examples](examples/revision/README.md) demonstrate the host-controlled workflow. This extension remains a project draft pending review.

The [buffered LLM loop guide](docs/llm-loop.md) adds the first M5 slice: provider-neutral callbacks, host-bound signed system text, transcript-wide CDL checks, existing gate-backed tools and buffered final authorization. The [paired mock examples](examples/llm/README.md) need no provider account. 69 shared cases compare actual calls, suppressed output and provider-visible transcripts. The [durable loop guide](docs/llm-durable.md) adds atomic state/answer receipts, host-approved completion, explicit lockdown and current-policy recovery, with 62 shared cases and mixed-language restart/commit-race checks. The [prompt refresh guide](docs/llm-refresh.md) adds host-approved expiration/interval refresh, with 64 shared cases, eight version comparisons and mixed-language restart/write-race checks. The [redirect guide](docs/llm-redirect.md) adds host-selected atomic source completion and target-session creation, retained CDL evidence and authorized recovery. The [scoped continuation guide](docs/llm-scoped.md) adds replacement signed SYSTEM prompts, host boundary checks, durable threat/violation state and authorized recovery while the workflow remains completed. Streaming, scoped tools, combined completion/refresh modes, other refresh modes and live-provider adapters remain unsupported.

The opt-in [MCP prompt refresh adapter](docs/llm-mcp-refresh.md) now discovers a host-approved refresh tool over stdio or authenticated HTTP. Owner/session pinning and exact schemas constrain the host-only exchange; the existing loop still verifies signatures, scope, freshness, version continuity and compatibility. It adds 29 shared cases, seven loop cases per language and 32 mixed-language transport calls. A managed signing service, custom URLs and additional refresh triggers remain pending.

The opt-in [session lifecycle draft](docs/lifecycle.md) adds owner-scoped listing, cancellation and bounded policy-approved payload cleanup in both languages. Checkpoint/operation invalidation, replay tombstones and retained metadata have explicit contracts. This #37 working slice requires review; it does not complete M3 or claim physical erasure.

The opt-in [security tools draft](docs/security-tools.md) adds authenticated scan/decrypt/process in both languages, host-owned AES-GCM key/zone grants and buffered CDL plaintext release. Its 62 shared cases and real two-way HTTP/stdio checks cover all eleven required tool names as draft counterparts. #35 normative API adoption and unsupported encryption forms remain open; this does not complete M3.
