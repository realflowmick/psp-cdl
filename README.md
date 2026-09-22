# PSP & CDL

Open standards and reference implementations for protecting LLM workflows, sponsored by **RealflowCloud, Inc.**

- **Prompt State Protocol (PSP)** describes signed prompt sections, workflow state, node/tool affinity, provenance, and session controls.
- **Covenant Declaration Language (CDL)** describes data classifications, handling constraints, and processing capabilities.

**Status: proposed standards; experimental reusable libraries.** TypeScript and Python implement PSP markup/object/JSON codecs, signatures and deterministic CDL policy evaluation. Reusable HTTP/MCP security adapters expose authenticated verification and policy evaluation; a portable state library adds durable SQLite sessions, nodes and single-use checkpoints. Proxies and public stateful workflow services remain pending. Library tests establish scoped behavior, not production readiness, full protocol conformance or measured security effectiveness. This repository is independent of the sponsor's commercial SaaS; no RealflowCloud account is required.

## Standards

| Document | Version | Status |
| --- | --- | --- |
| [PSP Core](specs/psp/RFC-PSP-CORE-v3_2_0.md) | 3.2.0 | Proposed Standard |
| [CDL](specs/cdl/RFC-CDL-v1_5.md) | 1.5 | Proposed Standard |

The [3.1.1 baseline](specs/psp/RFC-PSP-CORE-v3_1_1.md) remains archived. The [signature profile](specs/profiles/PSP-SIGNATURE-2.0.md) resolves the initial signing ambiguities and has executable cross-language byte/crypto vectors. [CDL Deterministic Policy Profile 1.0](specs/profiles/CDL-DETERMINISTIC-1.0.md) defines finite matching rules, authorized negation and evidence requirements; [PSP Trust and Enforcement Profile 1.0](specs/profiles/PSP-TRUST-1.0.md) defines six trust levels and scoped topology guarantees. [PSP Codec Profile 1.0](specs/profiles/PSP-CODEC-1.0.md) defines reversible markup, document objects and signed nested-document transport. These proposed profiles require explicit adoption; full protocol implementations are still pending. See the [reusable library API](docs/library-api.md).

Read the [remaining specification issues](specs/errata/README.md) before implementing cryptography or claiming interoperability. RFC-PSP-API is referenced by PSP but was not supplied; local API contracts will be drafts until reviewed. These are project RFCs, not IETF or IANA approvals.

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

`npm run check` checks repository contracts, compiles all TypeScript packages, executes library tests and audits signature/policy fixtures. The profile harness runs 511 shared codec, signature, policy and trust checks through public library APIs. Parity checks exchange actual output in both directions. The inventory command still lists only the five original seed cases; `npm run conformance` deliberately fails because full workflow adapters are pending. See [development](docs/development.md) for the detailed workflow.

## Participate

Start with [CONTRIBUTING](CONTRIBUTING.md), [GOVERNANCE](GOVERNANCE.md), [MAINTAINERS](MAINTAINERS.md), and [SECURITY](SECURITY.md). Specification changes, code changes, and empirical security claims each need appropriate evidence. The sponsor supports the project; sponsorship does not establish conformance or influence published evaluation outcomes.

## Licensing

The two standards, specification material, schemas, and shared conformance vectors are dedicated to the public domain under [CC0 1.0](LICENSES/CC0-1.0.txt). Reference code, tooling, tests, examples, and general documentation use [Apache-2.0](LICENSE). See [LICENSING](LICENSING.md) for exact path scopes and the recorded CDL license-notice change. Third-party names and standards retain their respective rights.

The [service API guide](docs/service-api.md) covers the first read-only M3 slice: shared host-authorized services, HTTP adapters and MCP stdio tools in both languages. The same core/CDL libraries handle parsing, signatures and decisions across these entry points.

The [persistence guide](docs/persistence.md) explains storage needs, SQLite/PostgreSQL options and the reusable host API. Both languages share one SQLite format and pass file/token interchange, restart and competing-update/resume tests. Storage adapters remain separate from public transports and host authentication.
