# GitHub operations

The configured public repository is https://github.com/realflowmick/psp-cdl. The owner is the authenticated founding lead. No organization was available during setup; organization-only teams are documented in .github/repository-settings.json and are not provisioned or staffed.

After local checks, an authenticated administrator can reconcile settings and seed missing roadmap issues:

    uv run python scripts/provision-github.py --seed-issues

For a first publication only, add --create. The script creates a missing public repository, pushes main, configures settings, and writes a verified report to ignored .artifacts/github-provisioning.json. It refuses to publicize an existing private repository or lower an existing approval requirement.

Main requires pull requests, the GitHub Actions check "Repository checks", current-base checks, resolved conversations, linear history, and no force pushes or deletion. Rules apply to administrators. The solo-maintainer bootstrap requires zero independent approvals so the lead can maintain the project without approving their own PR. CODEOWNERS requests review; it is not a second reviewer. Once another maintainer is appointed, run with --required-approvals 1 to require independent and code-owner review.

Private vulnerability reporting, dependency alerts, automated security fixes, secret scanning, and push protection are enabled by the script. Workflow tokens default to read permission and cannot approve PRs. CI uses pinned action commits and no repository secrets.

No packages, images or releases are published by CI. Add trusted publishing, protected release environments, SBOMs and provenance in M7 once reviewed implementations exist. Team membership and external contributor access require named appointments; do not derive access grants from sponsorship.

See the official [branch protection documentation](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches) for the enforced GitHub behavior.
