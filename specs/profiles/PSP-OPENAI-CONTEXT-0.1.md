# PSP OpenAI Context Transcript 0.1

Status: experimental opt-in project draft. License: CC0-1.0.
Extends PSP-OPENAI-CHAT-0.1 for PSP-CONTEXT-SERVICE-0.1. Published baselines and
the default provider transcript grammar are unchanged. Basis: PSP Core 3.2.0
§§4, 5.2–5.4, 15–16, 22; CDL 1.5 §§4–7 and 10–13.

The host selects `transcriptProfile: "PSP-OPENAI-CONTEXT-0.1"` when constructing
the existing provider adapter. The distinct registration IDs are
`openai-chat-context` and `openai-chat-context-offline`, with revision
`chat-v1-gpt-4.1-mini-2025-04-14-context-0.1`. Hosts must bind the selected ID and
revision in their current authority snapshot and signed prompt. Omitting the
option retains the original IDs, revision and accepted transcript forms.
Unknown profile values reject before transport.

The first two messages remain exactly one SYSTEM string and one USER string.
After those, this profile additionally transports exact `{role, content}`
objects whose role is `user` or `assistant` and whose content is a string.
They retain their position, role and text. Context/service state views, receipts,
denials and prior model proposals can therefore survive the provider mapping.
No message is promoted to SYSTEM and JSON-looking text grants no host authority.
The adapter transports content; it neither authenticates a service receipt nor
interprets PSP transitions. The context loop and host retain those boundaries.

Existing paired tool-call/result validation remains mandatory. An additional
text message cannot interrupt a pending tool call. Additional SYSTEM/developer
messages, arbitrary roles, metadata fields, multimodal content, orphan results,
unfinished calls and scoped transcripts beginning with an assistant message
remain rejected. This is not completion/scoped-mode composition.

Endpoint, pinned model, request/reply bounds, budget reservation, capabilities,
live opt-in, usage handling, cancellation and buffered release rules remain those
of PSP-OPENAI-CHAT-0.1. Selecting this profile does not enable network calls by
itself. Both language implementations and the joint harness exercise it through
offline synthetic transports; no live model result is claimed.

Official API mapping basis, checked 2026-09-30: the
[Chat Completions request schema](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create)
accepts user and assistant message content strings. This project profile selects
a narrower subset and does not change OpenAI's API contract.
