# SPDX-License-Identifier: Apache-2.0
"""One isolated synthetic scenario. Network requires explicit live admission."""
import json
import os
import sys
from pathlib import Path
from context_service_fixtures import run_case, CONFIGURATION
from interpreter_validation import grade_case
from psp_cdl_llmproxy import create_openai_chat_provider, OPENAI_CHAT_MODEL, OPENAI_CONTEXT_PROFILE

ROOT = Path(__file__).resolve().parents[1]


def main():
    request = json.load(sys.stdin)
    suite = json.loads((ROOT/'conformance/vectors/llm/interpreter-validation-0.1.json').read_text(encoding='utf-8'))
    case_id = request['observation']['caseId'] if request.get('action') == 'grade' else request['caseId']
    case = next(c for c in suite['cases'] if c['id'] == case_id)
    if request.get('action') == 'grade':
        print(json.dumps(grade_case(case, request['observation']), ensure_ascii=False))
        return
    mode = request['mode']
    if mode not in ('rehearsal', 'live'):
        raise ValueError('INVALID_REQUEST')
    provider = None
    usage = []
    if mode == 'live':
        config = request['provider']
        if sys.argv[1:] != ['--allow-live'] or config.get('complete') is not True or not config.get('sources'):
            raise ValueError('LIVE_NOT_ADMITTED')
        provider = create_openai_chat_provider({'mode': 'live', 'allowLive': True, 'apiKey': os.environ.get('PSP_OPENAI_API_KEY', ''),
                                               'now': lambda: 1000, 'complete': True, 'sources': config['sources'], 'transcriptProfile': OPENAI_CONTEXT_PROFILE,
                                               'limits': config['limits'], 'onUsage': usage.append})
    else:
        if len(sys.argv) != 1:
            raise ValueError('INVALID_REQUEST')
        proposals = [*case['proposals'], *([{'type': 'answer', 'text': 'Resumed from the persisted state.'}] if case['flags'].get('resume') else [])]
        cursor = 0
        def transport(_body, _stop):
            nonlocal cursor
            proposal = proposals[min(cursor, len(proposals)-1)]
            cursor += 1
            reply = {'id': 'chatcmpl-synthetic', 'object': 'chat.completion', 'created': 1000, 'model': OPENAI_CHAT_MODEL,
                     'choices': [{'index': 0, 'finish_reason': 'stop', 'message': {'role': 'assistant', 'content': json.dumps(proposal)}}],
                     'usage': {'prompt_tokens': 30, 'completion_tokens': 4, 'total_tokens': 34}}
            return {'status': 200, 'contentType': 'application/json', 'body': json.dumps(reply).encode('utf-8')}
        provider = create_openai_chat_provider({'mode': 'offline', 'now': lambda: 1000, 'complete': True,
                                               'sources': [{'id': 'synthetic-rehearsal', 'capabilities': []}], 'transcriptProfile': OPENAI_CONTEXT_PROFILE,
                                               'limits': request.get('provider', {}).get('limits', suite['providerLimits']),
                                               'onUsage': usage.append, 'transport': transport})
    runtime = {k: case[k] for k in ('initialState', 'message', 'flags')}
    runtime['flags'] = dict(runtime['flags'])
    runtime['proposals'] = case['proposals'] if mode == 'rehearsal' else []
    config = {**CONFIGURATION, 'application': (ROOT/'examples/in-context/validation/application.psp').read_text(encoding='utf-8')}
    actual = run_case(runtime, provider=provider, configuration=config, capture=True)
    print(json.dumps({'profile': suite['profile'], 'caseId': case_id, 'mode': mode, 'language': 'python', 'usage': usage, 'actual': actual}, ensure_ascii=False))


if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8')
    sys.stdin.reconfigure(encoding='utf-8')
    main()
