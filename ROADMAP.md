# Implementation roadmap

The repository setup is milestone M0. The following milestones are implementation work, not completed security features. Track them with `.github/bootstrap-issues.json`; publication can seed matching GitHub milestones and issues.

| Milestone | Work | Completion gate |
| --- | --- | --- |
| M0: Project foundation | Public repository, governance, workspaces, CI, licenses, shared registry | Local checks pass; GitHub settings and CI verified after authentication |
| M1: Normative profile | Resolve signature formula and signed fields, canonicalization, CDL unknown/negation rules, minimum topology and trust assumptions | Reviewed profile, requirements inventory, unambiguous valid/invalid byte vectors |
| M2: Portable core | PSP parser, canonicalization, Ed25519 verification, trusted key resolver, time/version validation; CDL parsing, inheritance, Appendix B policy tables | TypeScript/Python differential parity; tampering, malformed input, boundary and fuzz cases pass |
| M3: Reference services | Draft OpenAPI and MCP contracts; session store, nodes, checkpoints, verify/scan/decrypt/process interfaces | Authenticated tenant-scoped contract tests, durable-state and replay tests; MCP transport interoperability |
| M4: MCPProxy | Authenticated discovery, namespaced tool routing, active-node allow-list, CDL PDP, response provenance, policy version binding | Denied requests never reach tool spies; capability drift, bypass, cancellation and malformed-response tests |
| M5: LLMProxy | Provider-neutral adapter; pre-inference CDL checks, signed prompt assembly, tool dispatch gate, output/display gate, completion policy and refresh | Full mediated loop; streaming cannot release forbidden content; credentials and tenant/session isolation tested |
| M6: Interoperability and effectiveness | Cross-language mixed stacks, topologies A/B/C, baselines and ablations, adversarial and benign corpus | Reproducible signed result manifest, independent outcome grading, confidence intervals and all negative results |
| M7: Reviewed release | Documentation, packages, images, SBOMs, provenance, compatibility matrix, external security review | No unresolved critical findings, independent review, repeatable release and explicitly scoped conformance claim |

The signature portion of M1 is specified by PSP Core 3.2.0 and [PSP Signature Profile 2.0](specs/profiles/PSP-SIGNATURE-2.0.md), with independently checked Node/Python fixtures. [CDL Deterministic Policy Profile 1.0](specs/profiles/CDL-DETERMINISTIC-1.0.md) and [PSP Trust and Enforcement Profile 1.0](specs/profiles/PSP-TRUST-1.0.md) now specify CDL inheritance, finite policy tables, trust and topology assumptions. Every CDL Appendix B.2/B.3 row is mapped; all 315 policy/trust vectors now execute against both reusable library adapters. M1 still needs full RFC requirement extraction and parser-contract review; no complete conformance claim is available.

The first M2 slice is implemented as reusable TypeScript/Python libraries: bounded PSP/CDL codecs, object/JSON/markup round trips, signature/key/time validation, finite policy evaluation and shared profile adapters. The [API guide](docs/library-api.md) documents supported representations and limits. Both languages pass 511 shared checks plus direct two-way interchange and isolated package checks. This is experimental, scoped profile coverage; broader RFC grammar review, sustained fuzzing and independent security review remain open.

The first read-only M3 slice implements [draft authenticated HTTP/MCP security services](docs/service-api.md) on the reusable libraries, including operation-bound verification and host-owned policy evaluation. Both languages pass 33 shared service cases and real mixed-language HTTP/stdio checks. The [stateful library foundation](docs/persistence.md) adds tenant/owner-scoped sessions, immutable nodes, atomic versioned updates and checkpoint consumption on a replaceable SQLite backend. Both languages pass 42 shared state cases, bidirectional file/token interchange, abrupt-exit recovery and mixed-language races. Next, expose authenticated stateful contracts with host transition authorization and session-bound operation snapshot issuance/invalidation. Add cancellation/listing/retention and a PostgreSQL adapter; complete remaining security tools and outbox/dispatch integration separately.

## Suggested follow-up tasks

1. **Review the standards for implementability.** Start with `specs/errata/README.md`; enumerate every MUST/MUST NOT and resolve ambiguous requirements with the author. Draft the reference profile without silently rewriting published RFCs.
2. **Build shared vectors before security code.** Include exact input bytes, fixed clocks, public test keys, expected decisions and reason codes. Add malformed, tampered, replayed, expired, cross-tenant and clean controls. Mark draft expectations until the profile is accepted.
3. **Implement core and CDL in TypeScript, then Python.** Keep independent implementations with a common oracle. Prove parser, canonical byte, signature, and policy parity before network services depend on them.
4. **Implement MCP and API servers.** Cover the eleven required `realflow.*` tools in PSP §22.5.2. Treat these as reference wire names, not a SaaS dependency. Add a benign synthetic data server and a deliberately adversarial test server, with network isolation in the harness.
5. **Implement MCPProxy, then LLMProxy.** Use mock providers and tool spies first. Add real providers only behind explicit credential and cost opt-in. A model's claimed node, trust level, capability, or approval is never the authority.
6. **Run the effectiveness study.** Measure successful prohibited actions and useful benign completions, not just refusal language. Compare no controls, PSP only, CDL only, and combined controls across A/B/C and mixed-language deployments.
7. **Prepare a release candidate.** Obtain independent review, validate packaging and upgrade paths, publish reproducibility artifacts, and state exactly what is and is not enforced.

Work can be divided among language maintainers after M1 fixes shared contracts. No schedule, success rate, or production readiness is asserted by this roadmap.
