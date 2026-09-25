# SPDX-License-Identifier: Apache-2.0
"""Opt-in, buffered OpenAI Chat mapping. No import-time network or credential lookup."""
import http.client
import re
import socket
import ssl
import threading
import time

from psp_cdl_core import canonical_json, parse_json
from psp_cdl_cdl import aggregate_capabilities
from psp_cdl_api_server.persistence import bounded, integer

OPENAI_CHAT_PROFILE = "PSP-OPENAI-CHAT-0.1"
OPENAI_CHAT_MODEL = "gpt-4.1-mini-2025-04-14"
OPENAI_CHAT_REVISION = "chat-v1-gpt-4.1-mini-2025-04-14-psp-0.1"
OPENAI_CHAT_INPUT_RESERVATION = 1_047_576
MAX_BYTES = 1_048_576
ERROR_CODES = frozenset(("INVALID_CONFIGURATION", "INVALID_REQUEST", "INVALID_RESPONSE", "REQUEST_TOO_LARGE", "RESPONSE_TOO_LARGE",
                        "BUDGET_EXHAUSTED", "PROVIDER_BUSY", "CANCELLED", "DEADLINE_EXCEEDED", "PROVIDER_HTTP_ERROR", "PROVIDER_FAILED", "HOST_ERROR"))


class ProviderError(ValueError):
    def __init__(self, code):
        super().__init__(code)
        self.code = code


def _fail(code):
    raise ProviderError(code)


def _exact(value, keys):
    return type(value) is dict and set(value) == set(keys)


def _allowed(value, keys):
    return type(value) is dict and set(value) <= set(keys)


def _copy(value, code):
    try:
        return bounded(value)
    except Exception:
        pass
    _fail(code)


def _parse(source):
    try:
        return parse_json(source)
    except Exception:
        pass
    _fail("INVALID_RESPONSE")


def _encode_request(value, limits):
    value = _copy(value, "INVALID_REQUEST")
    if (not _exact(value, ["messages", "tools"]) or type(value["messages"]) is not list
            or type(value["tools"]) is not list or len(value["messages"]) < 2 or len(value["tools"]) > 128):
        _fail("INVALID_REQUEST")
    # Validate names before sorting so malformed values fail identically in both languages.
    for tool in value["tools"]:
        if (not _exact(tool, ["name", "inputSchema", "outputSchema"]) or type(tool["name"]) is not str
                or not re.fullmatch(r"[A-Za-z0-9_.-]{1,256}", tool["name"])
                or type(tool["inputSchema"]) is not dict or type(tool["outputSchema"]) is not dict):
            _fail("INVALID_REQUEST")
    tools = sorted(value["tools"], key=lambda t: t["name"])
    names = [t["name"] for t in tools]
    if len(set(names)) != len(names):
        _fail("INVALID_REQUEST")
    wire_tools = [{"type": "function", "function": {"name": f"psp_tool_{i}", "description": t["name"], "parameters": t["inputSchema"]}} for i, t in enumerate(tools)]
    messages, pending, call = [], None, 0
    for i, message in enumerate(value["messages"]):
        if type(message) is not dict:
            _fail("INVALID_REQUEST")
        if i < 2:
            if (not _exact(message, ["role", "content"]) or message["role"] != ("system" if i == 0 else "user")
                    or type(message["content"]) is not str):
                _fail("INVALID_REQUEST")
            messages.append(message)
        elif pending is None and _exact(message, ["role", "call"]) and message["role"] == "assistant":
            item = message["call"]
            if not _exact(item, ["name", "arguments"]) or item["name"] not in names or type(item["arguments"]) is not dict:
                _fail("INVALID_REQUEST")
            call_id = f"psp_call_{call}"
            call += 1
            pending = (item["name"], call_id)
            messages.append({"role": "assistant", "content": None, "tool_calls": [{"id": call_id, "type": "function", "function": {
                "name": f"psp_tool_{names.index(item['name'])}", "arguments": canonical_json(item["arguments"])
            }}]})
        elif (pending is not None and _exact(message, ["role", "name", "data"]) and message["role"] == "tool"
              and message["name"] == pending[0] and type(message["data"]) is dict):
            messages.append({"role": "tool", "tool_call_id": pending[1], "content": canonical_json(message["data"])})
            pending = None
        else:
            _fail("INVALID_REQUEST")
    if pending is not None:
        _fail("INVALID_REQUEST")
    request = {"model": OPENAI_CHAT_MODEL, "messages": messages, "stream": False, "n": 1, "store": False,
               "max_completion_tokens": limits["maxOutputTokens"]}
    if tools:
        request.update(tools=wire_tools, parallel_tool_calls=False, tool_choice="auto")
    body = None
    try:
        body = canonical_json(request).encode("utf-8")
    except Exception:
        pass
    if body is None or len(body) > limits["maxRequestBytes"]:
        _fail("REQUEST_TOO_LARGE")
    return body, names


def _decode_reply(reply, names, limits):
    if not _exact(reply, ["status", "contentType", "body"]) or not integer(reply["status"]):
        _fail("INVALID_RESPONSE")
    if reply["status"] != 200:
        _fail("PROVIDER_HTTP_ERROR")
    if (type(reply["contentType"]) is not str or not re.fullmatch(r"application/json(?:\s*;\s*charset=utf-8)?", reply["contentType"], re.I)
            or type(reply["body"]) is not bytes):
        _fail("INVALID_RESPONSE")
    if len(reply["body"]) > limits["maxResponseBytes"]:
        _fail("RESPONSE_TOO_LARGE")
    source = None
    try:
        source = reply["body"].decode("utf-8", errors="strict")
    except Exception:
        pass
    if source is None:
        _fail("INVALID_RESPONSE")
    result = _parse(source)
    if (not _allowed(result, ["id", "object", "created", "model", "choices", "usage", "system_fingerprint", "service_tier"])
            or type(result.get("id")) is not str or not result["id"] or not integer(result.get("created"))
            or result.get("object") != "chat.completion" or result.get("model") != OPENAI_CHAT_MODEL
            or type(result.get("choices")) is not list or len(result["choices"]) != 1):
        _fail("INVALID_RESPONSE")
    usage = result.get("usage")
    if (not _allowed(usage, ["prompt_tokens", "completion_tokens", "total_tokens", "prompt_tokens_details", "completion_tokens_details"])
            or any(not integer(usage.get(k)) for k in ("prompt_tokens", "completion_tokens", "total_tokens"))
            or usage["prompt_tokens"] > OPENAI_CHAT_INPUT_RESERVATION or usage["completion_tokens"] > limits["maxOutputTokens"]
            or usage["total_tokens"] != usage["prompt_tokens"] + usage["completion_tokens"]):
        _fail("INVALID_RESPONSE")
    choice = result["choices"][0]
    if (not _allowed(choice, ["index", "message", "finish_reason", "logprobs"]) or not integer(choice.get("index"))
            or choice["index"] != 0 or choice.get("logprobs") is not None):
        _fail("INVALID_RESPONSE")
    message = choice.get("message")
    if (not _allowed(message, ["role", "content", "refusal", "annotations", "tool_calls"]) or message.get("role") != "assistant"
            or message.get("refusal") is not None or "annotations" in message and message["annotations"] != []):
        _fail("INVALID_RESPONSE")
    if (choice.get("finish_reason") == "stop" and type(message.get("content")) is str
            and ("tool_calls" not in message or message["tool_calls"] == [])):
        return _copy({"type": "final", "text": message["content"]}, "INVALID_RESPONSE")
    if (choice.get("finish_reason") != "tool_calls" or "content" not in message or message["content"] not in (None, "")
            or type(message.get("tool_calls")) is not list or len(message["tool_calls"]) != 1):
        _fail("INVALID_RESPONSE")
    tool = message["tool_calls"][0]
    if (not _exact(tool, ["id", "type", "function"]) or type(tool["id"]) is not str
            or not re.fullmatch(r"[A-Za-z0-9_-]{1,128}", tool["id"]) or tool["type"] != "function"
            or not _exact(tool["function"], ["name", "arguments"]) or type(tool["function"]["arguments"]) is not str):
        _fail("INVALID_RESPONSE")
    aliases = [f"psp_tool_{i}" for i in range(len(names))]
    if tool["function"]["name"] not in aliases:
        _fail("INVALID_RESPONSE")
    args = _parse(tool["function"]["arguments"])
    if type(args) is not dict:
        _fail("INVALID_RESPONSE")
    return _copy({"type": "tool", "name": names[aliases.index(tool["function"]["name"])], "arguments": args}, "INVALID_RESPONSE")


class _Call:
    def __init__(self):
        self.stop = threading.Event()
        self.connection = None
        self.socket = None

    def abort(self):
        self.stop.set()
        sock = self.socket
        # Shutdown interrupts reads; close alone may not interrupt a blocking read.
        if sock is not None:
            try:
                sock.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass


def _live_transport(key, max_bytes, timeout, body, call):
    connection = http.client.HTTPSConnection("api.openai.com", timeout=timeout, context=ssl.create_default_context())
    call.connection = connection
    try:
        if call.stop.is_set():
            _fail("CANCELLED")
        connection.connect()
        call.socket = connection.sock
        if call.stop.is_set():
            _fail("CANCELLED")
        connection.request("POST", "/v1/chat/completions", body, headers={
            "Authorization": "Bearer " + key, "Content-Type": "application/json", "Accept": "application/json",
            "Accept-Encoding": "identity", "Content-Length": str(len(body)), "Connection": "close"
        })
        response = connection.getresponse()
        if response.status != 200:
            _fail("PROVIDER_HTTP_ERROR")
        if response.getheader("Content-Encoding", "identity") != "identity":
            _fail("INVALID_RESPONSE")
        length = response.getheader("Content-Length")
        if length is not None and (not re.fullmatch(r"[0-9]+", length) or int(length) > max_bytes):
            _fail("RESPONSE_TOO_LARGE")
        parts, size = [], 0
        while True:
            if call.stop.is_set():
                _fail("CANCELLED")
            chunk = response.read1(min(16_384, max_bytes + 1 - size))
            if not chunk:
                break
            size += len(chunk)
            if size > max_bytes:
                _fail("RESPONSE_TOO_LARGE")
            parts.append(chunk)
        if length is not None and size != int(length):
            _fail("PROVIDER_FAILED")
        return {"status": 200, "contentType": response.getheader("Content-Type", ""), "body": b"".join(parts)}
    finally:
        connection.close()


def create_openai_chat_provider(config):
    """Return the existing provider registration; credentials/budget remain host-owned."""
    if type(config) is not dict or config.get("mode") not in ("live", "offline") or not callable(config.get("now")):
        _fail("INVALID_CONFIGURATION")
    live = config["mode"] == "live"
    keys = ["mode", "sources", "complete", "now", "limits"] + (["allowLive", "apiKey"] if live else ["transport"])
    if not _exact(config, keys):
        _fail("INVALID_CONFIGURATION")
    if (live and (config["allowLive"] is not True or type(config["apiKey"]) is not str or not re.fullmatch(r"[\x21-\x7e]{1,4096}", config["apiKey"]))
            or not live and not callable(config["transport"])):
        _fail("INVALID_CONFIGURATION")
    limits, sources = _copy(config["limits"], "INVALID_CONFIGURATION"), _copy(config["sources"], "INVALID_CONFIGURATION")
    if (not _exact(limits, ["maxRequestBytes", "maxResponseBytes", "maxOutputTokens", "maxCalls", "budgetTokens", "timeoutMs"])
            or any(not integer(v) or v < 1 for v in limits.values()) or limits["maxRequestBytes"] > MAX_BYTES
            or limits["maxResponseBytes"] > MAX_BYTES or limits["maxOutputTokens"] > 32_768 or limits["maxCalls"] > 32
            or limits["timeoutMs"] > 120_000):
        _fail("INVALID_CONFIGURATION")
    valid_caps = False
    try:
        aggregate_capabilities(sources, config["complete"])
        valid_caps = config["complete"] is True
    except Exception:
        pass
    if not valid_caps:
        _fail("INVALID_CONFIGURATION")
    # Integer-valued JSON numbers have the same semantics as JS safe integers.
    limits = {k: int(v) for k, v in limits.items()}
    now, key, transport = config["now"], config.get("apiKey", ""), config.get("transport")
    lock, calls, reserved = threading.Lock(), 0, 0

    def invoke(value, options):
        nonlocal calls, reserved
        if not lock.acquire(blocking=False):
            _fail("PROVIDER_BUSY")
        call = _Call()
        code = None
        lifecycle = threading.Lock()
        state = {"started": False, "finished": False, "returned": False}
        try:
            if not _exact(options, ["deadline", "cancelled"]) or not integer(options["deadline"]) or not callable(options["cancelled"]):
                _fail("INVALID_REQUEST")
            deadline, cancelled, start = options["deadline"], options["cancelled"], time.monotonic()

            def check():
                valid = False
                try:
                    current, stopped = now(), cancelled()
                    valid = integer(current) and type(stopped) is bool
                except Exception:
                    pass
                if not valid:
                    _fail("HOST_ERROR")
                if stopped:
                    _fail("CANCELLED")
                if current >= deadline or (time.monotonic() - start) * 1000 >= limits["timeoutMs"]:
                    _fail("DEADLINE_EXCEEDED")

            check()
            body, names = _encode_request(value, limits)
            check()
            reservation = OPENAI_CHAT_INPUT_RESERVATION + limits["maxOutputTokens"]
            if calls >= limits["maxCalls"] or reservation > limits["budgetTokens"] - reserved:
                _fail("BUDGET_EXHAUSTED")
            calls += 1
            reserved += reservation
            done, outcome = threading.Event(), {}

            def worker():
                try:
                    if call.stop.is_set():
                        _fail("CANCELLED")
                    outcome["reply"] = (_live_transport(key, limits["maxResponseBytes"], limits["timeoutMs"] / 1000, body, call)
                                        if live else transport(body, call.stop))
                except Exception as exc:
                    outcome["error"] = exc.code if isinstance(exc, ProviderError) and exc.code in ERROR_CODES else "PROVIDER_FAILED"
                finally:
                    done.set()
                    with lifecycle:
                        state["finished"] = True
                        if state["returned"]:
                            lock.release()

            worker_thread = threading.Thread(target=worker, daemon=True, name="psp-openai-io")
            worker_thread.start()
            state["started"] = True
            while not done.wait(0.01):
                check()
            check()
            if "error" in outcome:
                _fail(outcome["error"])
            result = _decode_reply(outcome["reply"], names, limits)
            check()
            return result
        except Exception as exc:
            code = exc.code if isinstance(exc, ProviderError) and exc.code in ERROR_CODES else "PROVIDER_FAILED"
        finally:
            call.abort()
            with lifecycle:
                state["returned"] = True
                if not state["started"] or state["finished"]:
                    lock.release()
        # Raise outside the handler so backend exceptions are not retained as context.
        _fail(code)

    return {"id": "openai-chat" if live else "openai-chat-offline", "revision": OPENAI_CHAT_REVISION,
            "sources": sources, "complete": True, "invoke": invoke}
