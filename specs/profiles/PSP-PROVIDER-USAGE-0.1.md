# PSP Provider Usage Observation 0.1

Status: optional project draft for host telemetry. This additive extension to
[OpenAI Chat 0.1](PSP-OPENAI-CHAT-0.1.md) changes neither published PSP/CDL semantics
nor the provider's pinned request/response mapping or revision.

An adopting host may supply `onUsage` to either provider factory. The callback
receives exactly `{attempt, promptTokens, completionTokens, totalTokens}` after
a complete response passes the existing response, model, choice and usage
validation. `attempt` is the one-based admitted attempt within that provider
registration; rejected admission does not advance it. Token counts are validated
nonnegative safe integers with `totalTokens = promptTokens + completionTokens`
and the existing per-attempt bounds. Only these four fields leave the adapter;
provider IDs, raw bodies, headers, detail fields and credentials do not.

The trusted host callback is synchronous; its return value is ignored. A thrown
exception becomes `HOST_ERROR`, suppresses the reply and does not refund its
reservation. Cancellation/deadline checks still apply after the callback. An
observed response can therefore have usage but no released answer. Modifying
the callback argument changes no provider result, authority or budget.

Malformed, failed or cancelled calls that never pass complete response
validation have no usage observation. Missing observations mean unknown usage,
never zero consumption. A late transport response after cancellation does not
emit a later observation. Report observation coverage separately from attempts
and retain missing trials. A validated response can be denied by the loop after
the adapter returns; its usage remains observed.

Counts are provider-reported telemetry, not authorization, independently
measured billing or a reason to replenish budget. Offline callback values are
synthetic and must be labeled accordingly. Existing full-context reservations
and the loop's output shape remain unchanged; telemetry never enters model
messages, tool arguments or signed authoritative bindings.

[Study report 0.2](../../schemas/study-0.2.schema.json) adds per-trial observations,
known-response totals and coverage. The archived 0.1 contract remains readable.
Rate-based estimates use operator-supplied upper rates with per-response upward
rounding; partial estimates cover only observed responses. Actual billing stays
unavailable. No effectiveness or complete-study claim follows from these fields.

API field basis: [official Chat Completions reference](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create),
checked 2026-09-26. Dedicated to the public domain under CC0-1.0; see
[license](../../LICENSES/CC0-1.0.txt).
