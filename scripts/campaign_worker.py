# SPDX-License-Identifier: Apache-2.0
"""Bounded JSON-lines worker; each process owns one synthetic episode."""
import json
import sys
import time
from pathlib import Path
from psp_cdl_core import parse_json
from campaign_provider import TextProvider, require
from campaign_host import CampaignHost


def emit(value):
    print(json.dumps(value, ensure_ascii=False, allow_nan=False), flush=True)


def main():
    host = None
    try:
        for line in sys.stdin:
            require(len(line.encode('utf-8')) <= 4*1024*1024, 'REQUEST_TOO_LARGE')
            request = parse_json(line)
            try:
                op = request['op']
                if op == 'init':
                    require(host is None, 'ALREADY_STARTED')
                    config = request['config']; limits = config['limits']; live = request['live']
                    require(live == (sys.argv[1:] == ['--allow-live']), 'LIVE_NOT_ADMITTED')
                    end = time.monotonic()+limits['episodeTimeoutSeconds']
                    cancelled = lambda: time.monotonic() >= end or Path(request_cancel).exists()
                    request_cancel = request['cancelFile']
                    host = CampaignHost(request['case'], request['gated'], request['secret'], request['database'],
                                        config['roles']['defender']['sources'] if live else [{'id': 'synthetic-offline', 'capabilities': []}],
                                        emit, int(time.time())+limits['episodeTimeoutSeconds'])
                    def transport(body):
                        # Scripted responses are only accepted in offline workers.
                        req = parse_json(body.decode('utf-8')); model = req['model']
                        if model.startswith('claude-'):
                            value = {'model': model, 'type': 'message', 'role': 'assistant', 'stop_reason': 'end_turn',
                                     'content': [{'type': 'text', 'text': scripted}], 'usage': {'input_tokens': 30, 'output_tokens': 20}}
                        else:
                            value = {'model': model, 'choices': [{'finish_reason': 'stop', 'message': {'role': 'assistant', 'content': scripted}}],
                                     'usage': {'prompt_tokens': 30, 'completion_tokens': 20}}
                        return {'status': 200, 'contentType': 'application/json', 'body': json.dumps(value).encode('utf-8')}
                    providers = {role: TextProvider(p, limits, limits['maxTurns']*(limits['maxDefenderCallsPerTurn'] if role == 'defender' else 1),
                                 live=live, allow_live=live, transport=None if live else transport, cancelled=cancelled)
                                 for role, p in config['roles'].items()}
                    result = host.view()
                else:
                    require(host is not None, 'NOT_STARTED')
                    require(not cancelled(), 'CANCELLED')
                    if op == 'invoke':
                        require(not live or 'scripted' not in request, 'INVALID_REQUEST')
                        scripted = request.get('scripted', '')
                        result = providers[request['role']].invoke(request['system'], request['messages'])
                    elif op == 'turn': host.turn = request['turn']; host.payload = request['payload']; result = host.view()
                    elif op == 'view': result = host.view()
                    elif op == 'verify': host.verify_system(request['text']); result = True
                    elif op == 'execute': result = host.execute(request['command'], cancelled)
                    elif op == 'release': result = host.release(request['text'])
                    elif op == 'close': emit({'kind': 'result', 'value': True}); return
                    else: raise ValueError('INVALID_OPERATION')
                emit({'kind': 'result', 'value': result})
            except Exception as exc:
                emit({'kind': 'error', 'code': getattr(exc, 'code', 'WORKER_ERROR')})
    finally:
        if host is not None: host.close()


if __name__ == '__main__': main()
