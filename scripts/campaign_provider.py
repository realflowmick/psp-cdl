# SPDX-License-Identifier: Apache-2.0
"""Fixed-endpoint, bounded text adapters for the synthetic campaign runner."""
import hashlib
import http.client
import os
import re
import socket
import ssl
import threading
import time
from psp_cdl_core import canonical_json, parse_json
from psp_cdl_cdl import aggregate_capabilities, evaluate_policy

MODELS = {'anthropic': 'claude-opus-4-8', 'openai': 'gpt-4.1-mini-2025-04-14'}
INPUT_RESERVATION = 1048576


class CampaignError(ValueError):
    def __init__(self, code):
        self.code = code
        super().__init__(code)


def require(ok, code):
    if not ok: raise CampaignError(code)


def ready(config):
    require(config['model'] == MODELS.get(config['provider']), 'UNSUPPORTED_MODEL')
    require(config['complete'] is True and len(config['sources']) > 0, 'PROVIDER_NOT_REVIEWED')
    caps = aggregate_capabilities(config['sources'], True)
    decision = evaluate_policy({'classes': [], 'covenants': ['no-training'], 'capabilities': caps,
                                'checks': {}, 'parameters': {}, 'context': {}})
    require(decision['decision'] == 'allow', 'PROVIDER_POLICY_DENIED')


def encode(config, limits, system, messages):
    require(config['model'] == MODELS.get(config['provider']), 'UNSUPPORTED_MODEL')
    require(type(system) is str and bool(system) and type(messages) is list and 1 <= len(messages) <= 512, 'INVALID_REQUEST')
    require(all(type(m) is dict and set(m) == {'role', 'content'} and m['role'] in ('user', 'assistant') and type(m['content']) is str
                for m in messages) and messages[0]['role'] == 'user' and messages[-1]['role'] == 'user', 'INVALID_REQUEST')
    if config['provider'] == 'anthropic':
        request = {'model': config['model'], 'system': system, 'messages': messages, 'stream': False,
                   'max_tokens': limits['maxOutputTokens'], 'thinking': {'type': 'disabled'}}
    else:
        request = {'model': config['model'], 'messages': [{'role': 'system', 'content': system}, *messages],
                   'stream': False, 'store': False, 'n': 1, 'max_completion_tokens': limits['maxOutputTokens']}
    body = canonical_json(request).encode('utf-8')
    require(len(body) <= limits['maxRequestBytes'], 'CONTEXT_LIMIT')
    return body


def decode(config, limits, reply):
    require(type(reply) is dict and set(reply) == {'status', 'contentType', 'body'}, 'INVALID_RESPONSE')
    require(reply['status'] == 200, 'PROVIDER_HTTP_ERROR')
    require(type(reply['body']) is bytes and len(reply['body']) <= limits['maxResponseBytes'], 'RESPONSE_TOO_LARGE')
    require(type(reply['contentType']) is str and re.fullmatch(r'application/json(?:\s*;\s*charset=utf-8)?', reply['contentType'], re.I), 'INVALID_RESPONSE')
    try: value = parse_json(reply['body'].decode('utf-8', errors='strict'))
    except Exception: raise CampaignError('INVALID_RESPONSE') from None
    require(type(value) is dict and value.get('model') == config['model'], 'MODEL_MISMATCH')
    if config['provider'] == 'anthropic':
        require(value.get('type') == 'message' and value.get('role') == 'assistant' and value.get('stop_reason') == 'end_turn', 'INCOMPLETE_RESPONSE')
        content = value.get('content')
        require(type(content) is list and len(content) > 0 and all(type(b) is dict and b.get('type') == 'text' and type(b.get('text')) is str for b in content), 'UNSUPPORTED_RESPONSE')
        text = ''.join(b['text'] for b in content)
        usage = value.get('usage', {})
        require(type(usage) is dict, 'INVALID_USAGE')
        tokens = [usage.get('input_tokens'), usage.get('output_tokens'), usage.get('cache_creation_input_tokens', 0), usage.get('cache_read_input_tokens', 0)]
    else:
        choices = value.get('choices')
        require(type(choices) is list and len(choices) == 1 and type(choices[0]) is dict and choices[0].get('finish_reason') == 'stop', 'INCOMPLETE_RESPONSE')
        message = choices[0].get('message', {})
        require(type(message) is dict and message.get('role') == 'assistant' and type(message.get('content')) is str and message.get('tool_calls') is None and message.get('refusal') is None, 'UNSUPPORTED_RESPONSE')
        text = message['content']; usage = value.get('usage', {})
        require(type(usage) is dict, 'INVALID_USAGE')
        tokens = [usage.get('prompt_tokens'), usage.get('completion_tokens'), 0, 0]
    require(all(type(n) in (int, float) and 0 <= n <= INPUT_RESERVATION and int(n) == n for n in tokens), 'INVALID_USAGE')
    tokens = list(map(int, tokens))
    require(tokens[1] <= limits['maxOutputTokens'] and tokens[0]+tokens[2]+tokens[3] <= INPUT_RESERVATION, 'INVALID_USAGE')
    return {'text': text, 'model': value['model'], 'usage': {'inputTokens': tokens[0]+tokens[2]+tokens[3], 'outputTokens': tokens[1],
                                                           'cacheWriteTokens': tokens[2], 'cacheReadTokens': tokens[3]}}


def https_transport(provider, key, body, limits, cancelled):
    host, path = ('api.anthropic.com', '/v1/messages') if provider == 'anthropic' else ('api.openai.com', '/v1/chat/completions')
    headers = {'Content-Type': 'application/json', 'Accept': 'application/json', 'Accept-Encoding': 'identity'}
    if provider == 'anthropic': headers.update({'x-api-key': key, 'anthropic-version': '2023-06-01'})
    else: headers['Authorization'] = 'Bearer '+key
    connection = http.client.HTTPSConnection(host, timeout=limits['timeoutMs']/1000, context=ssl.create_default_context())
    stopped = threading.Event(); deadline = time.monotonic()+limits['timeoutMs']/1000
    def watch():
        while not stopped.wait(.02):
            if cancelled() or time.monotonic() >= deadline:
                try:
                    if connection.sock: connection.sock.shutdown(socket.SHUT_RDWR)
                    connection.close()
                except OSError: pass
                return
    watcher = threading.Thread(target=watch, daemon=True); watcher.start()
    try:
        require(not cancelled(), 'CANCELLED')
        connection.request('POST', path, body, headers)
        response = connection.getresponse()
        require(response.getheader('Content-Encoding', 'identity') == 'identity', 'INVALID_RESPONSE')
        require(response.status == 200, 'PROVIDER_HTTP_ERROR')
        chunks, size = [], 0
        while True:
            require(not cancelled(), 'CANCELLED'); require(time.monotonic() < deadline, 'DEADLINE_EXCEEDED')
            chunk = response.read(min(4096, limits['maxResponseBytes']+1-size))
            if not chunk: break
            size += len(chunk); require(size <= limits['maxResponseBytes'], 'RESPONSE_TOO_LARGE'); chunks.append(chunk)
        return {'status': response.status, 'contentType': response.getheader('Content-Type', ''), 'body': b''.join(chunks)}
    except CampaignError: raise
    except Exception:
        raise CampaignError('CANCELLED' if cancelled() else 'DEADLINE_EXCEEDED' if time.monotonic() >= deadline else 'PROVIDER_FAILED') from None
    finally:
        stopped.set(); connection.close(); watcher.join(timeout=.1)


class TextProvider:
    def __init__(self, config, limits, max_calls, *, live=False, allow_live=False, transport=None, cancelled=lambda: False):
        require(config['model'] == MODELS.get(config['provider']), 'UNSUPPORTED_MODEL')
        require(not live or allow_live and transport is None, 'LIVE_NOT_ADMITTED')
        require(live or transport is not None, 'OFFLINE_TRANSPORT_REQUIRED')
        if live: ready(config)
        self.config, self.limits, self.max_calls = config, limits, max_calls
        self.live, self.transport, self.cancelled, self.calls = live, transport, cancelled, 0

    def invoke(self, system, messages):
        require(not self.cancelled(), 'CANCELLED')
        body = encode(self.config, self.limits, system, messages)
        require(self.calls < self.max_calls, 'CALL_LIMIT')
        key = ''
        if self.live:
            key = os.environ.get('ANTHROPIC_API_KEY' if self.config['provider'] == 'anthropic' else 'PSP_OPENAI_API_KEY', '')
            require(bool(key) and '\r' not in key and '\n' not in key, 'CREDENTIAL_MISSING')
        self.calls += 1; start = time.monotonic()
        reply = https_transport(self.config['provider'], key, body, self.limits, self.cancelled) if self.live else self.transport(body)
        require(not self.cancelled(), 'CANCELLED')
        result = decode(self.config, self.limits, reply)
        return {**result, 'requestDigest': hashlib.sha256(body).hexdigest(), 'elapsedMs': round((time.monotonic()-start)*1000),
                'usageBasis': 'provider-reported' if self.live else 'synthetic-offline'}
