# ADR 0004: Reusable PSP/CDL libraries and reversible document transport

Status: accepted implementation direction and proposed codec profile, authorized by the originating author. Independent security review remains pending.

The author requires the same parsing and serialization libraries in proxies, MCP implementations and eventual open-source model integrations. Implement `core` and `cdl` as independent TypeScript/Python libraries. Services depend on these APIs rather than copying parsers or policy code. The TypeScript root codec has no Node built-in imports; Node cryptography is a separate `core/crypto` entry point. Python cryptography likewise has an explicit module. Neither library requires a server, SaaS account, network connection or repository files at runtime.

Adopt [Codec Profile 1.0](../../specs/profiles/PSP-CODEC-1.0.md) without rewriting archived RFCs. A versioned tree preserves nesting, text and unknown syntax. An optional validated source hint preserves exact formatting until the tree changes. Canonical emission preserves semantic content and escapes literal delimiters. Nested documents use a JSON envelope for signing instead of ambiguous text flattening. The existing three-field signature formula and strict expiration remain unchanged.

CDL transport preserves annotations independently of evaluating their meaning. Policy APIs retain origins, scoped negation grants, per-origin legal-basis groups and parameters. The finite schema traversal subset fails on unsupported applicators; host integration must visit every contributing data location. Authentication, discovery, fresh check evidence, replay controls and enforcement belong to later service layers.

Shared cases execute against public APIs in both languages. Differential tests additionally exchange produced markup, JSON, signed documents and CDL representations in both directions. Package checks install tarballs/wheels into separate consumer directories. These tests support scoped experimental readiness only. The complete RFC requirement inventory, broader parser/profile review, services, proxy dispatch, model attention isolation and effectiveness experiments remain outstanding.

Compatibility cost: adopters select the codec profile explicitly, including its escaping rules and limits. Unknown profiles and unrepresentable conversions fail visibly. Release publication remains disabled pending M7 review. The author's request to proceed authorizes this proposed profile and PR workflow under the existing solo-maintainer bootstrap; public review remains open.
