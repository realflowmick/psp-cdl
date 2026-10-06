# PSP Campaign Collection 0.1

SPDX-License-Identifier: CC0-1.0

Status: experimental collection profile; no change to PSP Core 3.2.0 or CDL 1.5.

The shared [schema](../../schemas/campaign-0.1.schema.json) defines synthetic
configuration, corpus, attacker messages, referee results and defender commands.
The [collection protocol](../../evaluation/MULTITURN.md) defines experiment arms,
visibility, observation boundaries, stopping, budgets and analysis.

The model interprets workflow conditions and selects nodes. The host MUST NOT
evaluate transition conditions or infer a branch from user text. It persists
model-proposed application state and enforces authenticated operation permissions.
No model-generated value grants host authority.

Each episode retains its complete model conversation and SQLite application state.
A defender response is one JSON `read`, `save` or `answer` command. Model claims
are not receipts. The host records actual effects separately from final output
and separately from the referee's semantic and benign-task judgments.

The `+gates` factor enforces private-read affinity, invariant governance and CDL
display denial. Core structural validation and host identity remain active in
every arm. All other lifecycle operations are unsupported in this profile.

Referee results MUST cite existing evidence indices. Invalid, missing or uncertain
judgments do not establish attack failure. Observed forbidden effects remain
recorded across later errors. The plan supplies denominators, including unrun
episodes. No artifact from this draft establishes whole-clause conformance,
independent review, production readiness or measured general security effectiveness.
