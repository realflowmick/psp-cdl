# Security policy

## Current status

This repository contains proposed standards and development scaffolds. There is no supported production release and no validated security guarantee. Security fixes initially target `main`; supported release lines will be listed here when releases exist.

## Reporting

Use the repository's **Security → Report a vulnerability** private reporting form once public GitHub provisioning enables it. If the form is unavailable, contact the founding lead privately through their GitHub profile to arrange a confidential channel. Do not submit exploit details, credentials, or real regulated data in public issues. Ordinary specification questions without an exploit can use the specification issue form.

Include affected RFC section/version or commit, minimal synthetic reproduction, expected and actual behavior, impact, and any mitigations. The maintainers aim to acknowledge within three business days and provide an initial assessment within seven; these are goals, not a staffed support SLA.

## Boundaries

Cryptographic verification establishes integrity under a key/trust policy; it does not force a model to obey text. Proxy enforcement depends on complete mediation, authenticated capability metadata, correct session/tenant binding, and no alternate egress route. Inference-engine attention isolation is not provided by ordinary API proxies. CDL declarations alone do not prove a provider actually meets a regulatory or operational claim.

Threat reports must identify their topology and enforcement point. See `docs/threat-model.md` and `evaluation/PROTOCOL.md`. Keys, auth tokens, full prompts, and customer data must not enter normal logs or evaluation artifacts.
