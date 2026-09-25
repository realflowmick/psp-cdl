# API adoption review (#35)

Public review: [PR #58](https://github.com/realflowmick/psp-cdl/pull/58). Opened 2026-09-25T13:00:31Z; adoption cannot occur before 2026-10-09T13:00:31Z and a recorded lead decision.

The [API 1.0.0 candidate](../specs/api/RFC-PSP-API-v1_0_0-candidate.md) proposes
a new normative document for all eleven required tool names. It is not adopted.
The [review record](../specs/api/adoption-1.0.0.json) is the source for the public
review URL, opening time, earliest close, objections and final decision.

The proposal selects the existing implemented contracts with explicit decisions
about host authority, private checkpoint tokens, projected views, mandatory
verification, encryption ordering and plaintext release. It does not convert the
illustrative Core examples into working compatibility aliases. The
[companion erratum](../specs/errata/PSP-API-EDITORIAL-0.2.md) separates the new API
reference from eleven future-edition heading corrections. Published RFC files
and existing 0.1 wire contracts remain unchanged.

| Decision | Current disposition |
| --- | --- |
| PSP-E006 absent API | New versioned normative API proposed |
| DOC-E001 numbering | Exact future corrections and anchor aliases proposed |
| Wire/authority differences | Candidate section 7 submitted for explicit review |
| PSP-E007–E009 parser/alias/refresh | Separate proposals remain draft |
| Final normative adoption | Pending the comment period and recorded lead decision |

For review, inspect the candidate's twenty stable requirement IDs, compatibility
table, [contract index](../specs/api/contract-set-1.0.0.json),
[OpenAPI bundle](../schemas/api/psp-api-1.0.0-candidate.openapi.json) and
[MCP catalog](../schemas/mcp/psp-api-1.0.0-candidate.json). Source contract/profile
hashes are pinned; the generator checks HTTP/MCP input and output equivalence.
The index preserves affected Core requirement IDs and links 33 security-service,
41 workflow, 27 lifecycle and 62 security-tool cases. Existing real transport,
restart, concurrency and rollback checks supply scoped implementation evidence.

Before adoption, the lead must:

1. Allow at least fourteen calendar days after public availability of the
   substantive candidate. Record later substantive amendments and restart the
   full comment window for those changes.
2. Record each review comment and its reasoned disposition, including remaining
   objections. An empty register before review closes is not consensus.
3. Record the lead's reasoned decision, exact revision, date and public reference.
   State whether independent review occurred; solo-maintainer CI/merge permission
   does not establish independent review or waive normative comment time.
4. Publish the final version if accepted, preserving the candidate, old RFCs and
   migration record. Only then update normative adoption status and close #35.
   M3 completion, independent security review and package release remain separate.

`scripts/generate-api-candidate.py --check` validates reproducibility and recorded
gate metadata. It cannot authorize adoption, authenticate a decision or prove
that all comments have been collected. Run it with the required TypeScript,
Python and parity suites. This PR changes specification/review artifacts, not
runtime behavior, package metadata or deployment settings.
