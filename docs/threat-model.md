# Initial threat model

Assets: signed workflow instructions, keys, capabilities, session state, tenant data, policy decisions, tool side effects, and user-visible output.

Adversaries can control user input, retrieved text, tool descriptions/responses, model-proposed calls and arguments, replayed messages, and an untrusted tool server. They may exploit parser ambiguity, stale policy state, streaming, asynchronous calls, or alternate network paths. Compromised signing authorities or host administrators are separate threat classes and need operational mitigations.

Required assumptions to test or state: trustworthy key/capability provisioning; complete mediation of all provider/tool paths; authenticated tenant/session/node binding; reliable clocks; durable and atomic state changes; no secret leakage through logs, errors or timing-sensitive comparisons. Signed malicious content is still malicious content; signatures alone do not prove safe semantics.

| Threat | Planned boundary/check | Observable failure |
| --- | --- | --- |
| Prompt or covenant tampering | PSP/CDL verification before use | Modified bytes accepted or dispatched |
| Forged tool capability | Authenticated discovery and policy snapshot | Self-asserted capability elevates access |
| Indirect injection | Provenance, node affinity, PDP | Unauthorized tool side effect |
| Session/tenant substitution | Auth bound to immutable session context | Cross-tenant read/write |
| Replay/rollback/expired signature | Time, version and replay state | Stale authorization used |
| Tool discovery/use race | Bind checked tool/policy version to dispatch | Different tool or policy executes |
| Output disclosure | Server, proxy, and display checks | Restricted canary appears at an egress boundary |
| Proxy bypass / topology downgrade | Deployment mediation and topology policy | Calls evade the gate |
| Prompt refresh or state-store outage | Explicit fail-closed policy | Side effect after authoritative state is lost |
| Model instruction failure | Host controls; semantic compliance measured separately | Model disobedience is reported as a hard guarantee |

PSP attention hierarchy requires support inside an inference engine to achieve actual attention isolation. Ordinary text tags and API roles cannot establish CPU-like isolation. Compare semantic adherence separately from host-enforced properties. The RFC's multiple-layer strength claims remain hypotheses until evaluated, including shared-mode failures.
