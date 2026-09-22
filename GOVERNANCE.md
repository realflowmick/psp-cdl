# Governance

This is an open, sponsor-supported project. RealflowCloud, Inc. is the founding sponsor. Mick Seals is the founding project lead. Decisions and technical rationales belong in repository issues, pull requests, and architecture decision records (ADRs).

## Roles and authority

| Role | Responsibilities | GitHub permission |
| --- | --- | --- |
| Project lead / steering maintainers | Charter, appointments, disputed decisions, releases | Maintain; minimum necessary admins separately |
| Specification editors | RFC text, errata, versioned profiles, public review | Write and specification CODEOWNERS |
| TypeScript maintainers | TypeScript implementations and interoperability | Write and TypeScript CODEOWNERS |
| Python maintainers | Python implementations and interoperability | Write and Python CODEOWNERS |
| Conformance and evaluation maintainers | Shared oracle, reproducibility, independent result review | Write and conformance/evaluation CODEOWNERS |
| Security response maintainers | Private reports, coordinated fixes, advisories | Write plus security advisory access |
| Release managers | Verify gates, artifacts, provenance and release notes | Maintain; release environment approval when enabled |
| Triagers | Labels, issue quality, reproductions | Triage |
| Contributors | Proposals, tests, docs, implementations | Public forks; no permission grant required |

The lead initially covers unfilled responsibilities. These are responsibility definitions, not claims that teams or reviewers already exist. See MAINTAINERS.md for appointments. Repository administration is separate from technical decision authority. Do not invent team members or grant access to unknown identities.

## Decisions

Routine implementation changes use pull requests. Normative changes need an RFC or erratum with motivation, compatibility effects, test vectors, and at least 14 calendar days for public comment. After review, the lead records consensus or a reasoned decision. Emergency security changes may use a shorter private process with later public rationale and no exploit disclosure before coordination.

The initial solo-maintainer bootstrap allows the lead to merge after checks pass, with an explicit record of the lack of independent review. Once a second qualified maintainer is appointed, enable one required independent approval and CODEOWNER review through the provisioning script. Security-sensitive releases require independent review before declaring production readiness; the solo exception is not evidence of independent security validation.

Specification disputes must identify the relevant requirement and competing interpretations. Until resolved, impacted cases remain blocked and implementations must disclose their selected profile. Do not silently change published version semantics. Breaking changes receive a new specification version.

## Appointments and sponsorship

Maintainers are appointed by a recorded lead/steering decision based on sustained contributions, review quality, and willingness to own an area. Removal or inactivity is recorded with handoff arrangements. Contributors can appeal decisions in a governance issue, with conflicts of interest disclosed and conflicted decision makers recused where another maintainer is available.

Sponsor funding, employment, and product compatibility do not grant private control of standards decisions. Publish negative as well as positive validation findings. The commercial SaaS and this project have separate release and support commitments. See `docs/sponsorship.md`.
