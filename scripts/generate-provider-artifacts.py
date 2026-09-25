# SPDX-License-Identifier: Apache-2.0
"""Explicit draft provider vectors and limits schema; expectations are not adapter output."""
import json
import sys
from copy import deepcopy
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MODEL = "gpt-4.1-mini-2025-04-14"
LIMITS = {"maxRequestBytes": 4096, "maxResponseBytes": 4096, "maxOutputTokens": 64,
          "maxCalls": 4, "budgetTokens": 4_200_000, "timeoutMs": 1000}
REQUEST = {"messages": [{"role": "system", "content": "Synthetic SYSTEM."}, {"role": "user", "content": "Read synthetic data 🧪."}],
           "tools": [{"name": "echo.read", "inputSchema": {"type": "object", "properties": {"message": {"type": "string"}}, "required": ["message"], "additionalProperties": False}, "outputSchema": {"type": "object"}}]}
FINAL = {"id": "chatcmpl-synthetic", "object": "chat.completion", "created": 1000, "model": MODEL,
         "choices": [{"index": 0, "finish_reason": "stop", "logprobs": None, "message": {"role": "assistant", "content": "Finished 🧪", "refusal": None, "annotations": []}}],
         "usage": {"prompt_tokens": 30, "completion_tokens": 4, "total_tokens": 34}}
TOOL = deepcopy(FINAL)
TOOL["choices"][0].update(finish_reason="tool_calls", message={"role": "assistant", "content": None, "tool_calls": [{"id": "call_backend_1", "type": "function", "function": {"name": "psp_tool_0", "arguments": '{"message":"hello 🧪"}'}}]})
cases = []


def add(name, code="OK", calls=1, released=None, scope="adapter", **settings):
    cases.append({"id": name, "scope": scope, "settings": settings, "expected": {
        "code": code, "transportCalls": calls, "released": int(code == "OK") if released is None else released,
        "toolCalls": settings.pop("expectedTools", 0)}})


add("final")
add("single-tool", responses=[TOOL])
add("no-tools", request={**REQUEST, "tools": []})
history = deepcopy(REQUEST)
history["messages"] += [{"role": "assistant", "call": {"name": "echo.read", "arguments": {"message": "hello 🧪"}}}, {"role": "tool", "name": "echo.read", "data": {"message": "hello 🧪"}}]
add("reconstructed-tool-history", request=history)
add("metadata-not-forwarded", responses=[{**FINAL, "system_fingerprint": "synthetic-fingerprint", "service_tier": "default"}])
for name, request in [
    ("extra-authority", {**REQUEST, "tenantId": "forged"}),
    ("stream-request", {**REQUEST, "stream": True}),
    ("model-override", {**REQUEST, "model": "other"}),
    ("duplicate-tools", {**REQUEST, "tools": REQUEST["tools"] * 2}),
    ("too-many-tools", {**REQUEST, "tools": REQUEST["tools"] * 129}),
    ("missing-system", {**REQUEST, "messages": REQUEST["messages"][1:]}),
    ("orphan-result", {**REQUEST, "messages": REQUEST["messages"] + [history["messages"][-1]]}),
    ("incomplete-call", {**history, "messages": history["messages"][:-1]}),
    ("multimodal", {**REQUEST, "messages": [REQUEST["messages"][0], {"role": "user", "content": [{"type": "text", "text": "hi"}]}]}),
    ("extra-system", {**REQUEST, "messages": REQUEST["messages"] + [REQUEST["messages"][0]]}),
    ("scoped-history-unsupported", {**REQUEST, "messages": [REQUEST["messages"][0], {"role": "assistant", "content": "completed"}, REQUEST["messages"][1]]})
]: add(name, "INVALID_REQUEST", 0, request=request)
add("request-bound", "REQUEST_TOO_LARGE", 0, limits={"maxRequestBytes": 16})
add("response-bound", "RESPONSE_TOO_LARGE", limits={"maxResponseBytes": 16})
for name, patch in [("no-budget", {"budgetTokens": 1}), ("one-attempt-budget", {"budgetTokens": 1_047_640}), ("one-call-budget", {"maxCalls": 1})]:
    add(name, "BUDGET_EXHAUSTED", 0 if name == "no-budget" else 1, released=0 if name == "no-budget" else 1, limits=patch, attempts=1 if name == "no-budget" else 2)
add("failed-attempt-not-refunded", "BUDGET_EXHAUSTED", limits={"maxCalls": 1}, attempts=2, status=429, released=0)
for name, config in [("live-opt-in-required", {"mode": "live", "allowLive": False, "apiKey": "SYNTHETIC_KEY"}),
                     ("credentials-required", {"mode": "live", "allowLive": True, "apiKey": ""}),
                     ("header-injection", {"mode": "live", "allowLive": True, "apiKey": "synthetic\r\ninjected"}),
                     ("custom-endpoint-rejected", {"endpoint": "http://example.invalid"}),
                     ("offline-credentials-rejected", {"apiKey": "SYNTHETIC_KEY"}),
                     ("capabilities-incomplete", {"complete": False}),
                     ("unknown-capability", {"sources": [{"id": "provider", "capabilities": ["invented-provider-capability"]}]})]:
    add(name, "INVALID_CONFIGURATION", 0, config=config)
for key, value in [("timeoutMs", 0), ("timeoutMs", 120001), ("budgetTokens", True), ("maxOutputTokens", 32769), ("maxCalls", 33), ("maxResponseBytes", 1048577)]:
    add(f"invalid-{key}-{value}", "INVALID_CONFIGURATION", 0, limits={key: value})
add("cancel-before-send", "CANCELLED", 0, preCancel=True)
add("deadline-before-send", "DEADLINE_EXCEEDED", 0, deadline=1000)
add("cancel-after-response", "CANCELLED", effect="cancel")
add("deadline-after-response", "DEADLINE_EXCEEDED", effect="deadline")
add("transport-exception", "PROVIDER_FAILED", throwTransport=True)
for status in (301, 401, 429, 500): add(f"http-{status}", "PROVIDER_HTTP_ERROR", status=status)
for name, settings in [("sse", {"contentType": "text/event-stream"}), ("invalid-json", {"rawBody": '{"incomplete":'}),
                       ("duplicate-json", {"rawBody": '{"object":"chat.completion","object":"other"}'}),
                       ("invalid-utf8", {"invalidUtf8": True}), ("bom-json", {"rawBody": "\ufeff{}"})]:
    add(name, "INVALID_RESPONSE", **settings)
for name, path, value in [
    ("wrong-model", ["model"], "other"), ("stream-chunk", ["object"], "chat.completion.chunk"),
    ("multiple-choices", ["choices"], FINAL["choices"] * 2), ("no-choices", ["choices"], []),
    ("truncated", ["choices", 0, "finish_reason"], "length"), ("filtered", ["choices", 0, "finish_reason"], "content_filter"),
    ("bad-index", ["choices", 0, "index"], True), ("unknown-message-field", ["choices", 0, "message", "authority"], "forged"),
    ("refusal", ["choices", 0, "message", "refusal"], "PRIVATE_REFUSAL"),
    ("annotations", ["choices", 0, "message", "annotations"], [{"type": "citation"}]),
    ("audio", ["choices", 0, "message", "audio"], {}),
    ("null-final", ["choices", 0, "message", "content"], None),
    ("bad-usage", ["usage", "total_tokens"], 1), ("overspend", ["usage"], {"prompt_tokens": 30, "completion_tokens": 65, "total_tokens": 95}),
    ("input-usage-over-bound", ["usage"], {"prompt_tokens": 1047577, "completion_tokens": 4, "total_tokens": 1047581}),
]:
    response = deepcopy(FINAL)
    target = response
    for key in path[:-1]: target = target[key]
    target[path[-1]] = value
    add(name, "INVALID_RESPONSE", responses=[response])
for name, mutation in [("parallel-calls", "parallel"), ("unknown-tool", "name"), ("malformed-arguments", "json"),
                       ("array-arguments", "array"), ("duplicate-arguments", "duplicate"), ("mixed-text-tool", "mixed"),
                       ("legacy-function", "legacy")]:
    response = deepcopy(TOOL)
    message = response["choices"][0]["message"]
    function = message["tool_calls"][0]["function"]
    if mutation == "parallel": message["tool_calls"] *= 2
    elif mutation == "name": function["name"] = "admin_write"
    elif mutation == "json": function["arguments"] = "{"
    elif mutation == "array": function["arguments"] = "[]"
    elif mutation == "duplicate": function["arguments"] = '{"a":1,"a":2}'
    elif mutation == "mixed": message["content"] = "PRIVATE_PARTIAL"
    elif mutation == "legacy": message["function_call"] = message.pop("tool_calls")[0]["function"]
    add(name, "INVALID_RESPONSE", responses=[response])

add("loop-tool-final", scope="loop", calls=2, expectedTools=1)
add("loop-final", scope="loop", responses=[FINAL])
for name, settings, code in [
    ("other-owner", {"token": "test-other"}, "NOT_FOUND"), ("other-tenant", {"token": "test-tenant"}, "NOT_FOUND"),
    ("expired-prompt", {"expiredPrompt": True}, "PROMPT_REJECTED"), ("wrong-prompt-owner", {"wrongPromptScope": True}, "PROMPT_REJECTED"),
    ("tampered-prompt", {"tamperedPrompt": True}, "PROMPT_REJECTED"), ("revoked-prompt", {"revokedPrompt": True}, "PROMPT_REJECTED"),
    ("wrong-provider", {"wrongProvider": True}, "STALE_AUTHORITY"), ("deny-inference", {"denyPhase": "inference"}, "POLICY_DENIED"),
    ("provider-training", {"providerTraining": True}, "POLICY_DENIED")
]: add("loop-"+name, code, 0, scope="loop", loop=settings)
for effect, code in [("cancel", "CANCELLED"), ("deadline", "DEADLINE_EXCEEDED"), ("expiry", "PROMPT_REJECTED"), ("drift", "STALE_AUTHORITY")]:
    add("loop-during-"+effect, code, scope="loop", effect=effect)
for name, settings, code, calls, tool_calls in [
    ("deny-tool", {"denyPhase": "tool"}, "POLICY_DENIED", 1, 0),
    ("deny-output", {"displayDenied": True}, "OUTPUT_DENIED", 2, 1),
    ("deny-final", {"finalDenied": True}, "COMPLETION_DENIED", 2, 1),
    ("deny-tool-data-before-inference", {"denyNextInference": True}, "POLICY_DENIED", 1, 1)
]: add("loop-"+name, code, calls, scope="loop", loop=settings, expectedTools=tool_calls)
add("loop-budget-exhaustion", "PROVIDER_FAILED", 1, scope="loop", limits={"maxCalls": 1}, expectedTools=1)
add("loop-provider-error", "PROVIDER_FAILED", scope="loop", status=429)
add("loop-truncated-suppressed", "PROVIDER_FAILED", scope="loop", responses=[{**FINAL, "choices": [{**FINAL["choices"][0], "finish_reason": "length"}]}])

schema = {"$schema": "https://json-schema.org/draft/2020-12/schema", "$id": "https://realflowcloud.org/psp/schemas/openai-chat-0.1.json",
          "title": "PSP OpenAI Chat Adapter 0.1 draft host limits", "$comment": "CC0-1.0. Host configuration only; callbacks and credentials never enter model input.",
          "type": "object", "additionalProperties": False, "required": list(LIMITS),
          "properties": {key: {"type": "integer", "minimum": 1, "maximum": maximum} for key, maximum in [
              ("maxRequestBytes", 1048576), ("maxResponseBytes", 1048576), ("maxOutputTokens", 32768),
              ("maxCalls", 32), ("budgetTokens", 9007199254740991), ("timeoutMs", 120000)]}}
suite = {"profile": "PSP-OPENAI-CHAT-0.1", "license": "CC0-1.0", "limits": LIMITS, "request": REQUEST, "final": FINAL, "tool": TOOL, "cases": cases}
for name, data in [("schemas/openai-chat.schema.json", schema), ("conformance/vectors/llm/openai-chat-0.1.json", suite)]:
    path = ROOT / name
    text = json.dumps(data, ensure_ascii=False, indent=2) + "\n"
    if "--check" in sys.argv:
        if not path.exists() or path.read_text(encoding="utf-8") != text:
            raise SystemExit("Stale provider artifact: " + name)
    else:
        path.write_text(text, encoding="utf-8")
print(f"{len(cases)} explicit provider cases and draft limits schema verified.")
