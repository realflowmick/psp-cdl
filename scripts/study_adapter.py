# SPDX-License-Identifier: Apache-2.0
"""Independent Python study host. Rubrics stay in the external grader."""
import json
import os
import sys
import tempfile
import time
from copy import deepcopy
from pathlib import Path
from psp_cdl_core import canonical_json
from psp_cdl_core.crypto import sign_envelope
from psp_cdl_cdl import evaluate_policy, aggregate_capabilities
from psp_cdl_api_server.persistence import WorkflowStore, OwnerCoordinator
from psp_cdl_api_server.sqlite import SqliteBackend
from psp_cdl_mcpproxy import McpDispatchGate, binding_digest
from psp_cdl_mcpproxy.mcp import StdioMcpClient
from psp_cdl_llmproxy import BufferedLlmLoop, prompt_context, create_openai_chat_provider, OPENAI_CHAT_MODEL, OPENAI_CHAT_INPUT_RESERVATION
from topology_common import CREDENTIAL, environment, read_events
from study_common import case_input, approval, resource, SYSTEM_TEXT, message


class StudyError(Exception):
    def __init__(self, code): self.code = code


def offline_reply(data, step, request):
    action = data['offlineSteps'][min(step,len(data['offlineSteps'])-1)]
    tool = next((t for t in request.get('tools',[]) if t['function']['description'] == 'study.'+action.get('tool','')),None)
    choice = ({'finish_reason':'tool_calls','message':{'role':'assistant','content':None,'tool_calls':[{'id':'synthetic_call','type':'function',
               'function':{'name':tool['function']['name'],'arguments':'{}'}}]}} if tool else
              {'finish_reason':'stop','message':{'role':'assistant','content':'UNAVAILABLE' if 'tool' in action else action['final']}})
    return {'id':'synthetic','object':'chat.completion','created':0,'model':OPENAI_CHAT_MODEL,'choices':[{'index':0,**choice}],
            'usage':{'prompt_tokens':10,'completion_tokens':5,'total_tokens':15}}


def direct_loop(provider, registrations, data, options, cdl, now):
    messages = [{'role':'system','content':SYSTEM_TEXT},{'role':'user','content':message(data)}]
    tools = [{'name':'study.'+r['name'],'inputSchema':r['inputSchema'],'outputSchema':r['outputSchema']} for r in registrations]
    def check():
        if options['cancelled'](): raise StudyError('CANCELLED')
        if now() >= options['deadline']: raise StudyError('DEADLINE_EXCEEDED')
    def decide(caps):
        covenants = ['no-display-to-operator'] if data['noDisplay'] and any(m['role'] == 'tool' and m['name'] == 'study.private' for m in messages) else []
        decision = evaluate_policy({**resource(covenants),'capabilities':caps})['decision']
        if decision != 'allow': raise StudyError('UNSUPPORTED_POLICY' if decision == 'unsupported' else 'OUTPUT_DENIED')
    for step in range(options['maxSteps']):
        check()
        if cdl: decide(aggregate_capabilities(provider['sources'],True))
        result = provider['invoke'](deepcopy({'messages':messages,'tools':tools}),{k:options[k] for k in ('deadline','cancelled')})
        check()
        if result['type'] == 'final':
            if cdl: decide(['can-display-to-operator'])
            return result['text']
        tool = next((r for r in registrations if 'study.'+r['name'] == result.get('name')),None)
        if result['type'] != 'tool' or tool is None or result['arguments'] != {}: raise StudyError('INVALID_RESPONSE')
        if step == options['maxSteps']-1: raise StudyError('STEP_LIMIT')
        if cdl: decide(aggregate_capabilities(tool['sources'],True))
        output = tool['invoke'](result['arguments'],{k:options[k] for k in ('deadline','cancelled')})
        check()
        messages.extend([{'role':'assistant','call':{'name':result['name'],'arguments':result['arguments']}},{'role':'tool','name':result['name'],'data':output}])
    raise StudyError('STEP_LIMIT')


def run_trial(config):
    data = case_input(config['caseId'])
    psp, cdl = config['condition'] in ('psp-only','combined'), config['condition'] in ('cdl-only','combined')
    if config['condition'] not in ('unprotected','psp-only','cdl-only','combined') or config['mode'] not in ('offline','live'):
        raise StudyError('INVALID_CONFIGURATION')
    if config['mode'] == 'live' and (config.get('allowLive') is not True or config.get('reservedMicroUsd',0) <= 0):
        raise StudyError('LIVE_NOT_AUTHORIZED')
    with tempfile.TemporaryDirectory(prefix='psp-study-') as directory:
        spy = str(Path(directory)/'events.jsonl')
        started, now = time.monotonic(), lambda:int(time.time())
        expires = now()+120
        options = {'deadline':now()+60,'cancelled':lambda:Path(config['cancelFile']).exists(),'maxSteps':4}
        requests, key = [], bytes([19])*32
        actor = {'tenantId':'study-tenant','subjectId':'study-owner'}
        peer = backend = session = None
        provider_calls, provider_error, output, code, api_key = 0, None, None, 'OK', ''
        try:
            step = 0
            def transport(body, _stop):
                nonlocal step
                reply = offline_reply(data,step,json.loads(body))
                step += 1
                return {'status':200,'contentType':'application/json','body':canonical_json(reply).encode()}
            provider_config = {'mode':config['mode'],'now':now,'complete':True,'sources':config['sources'],
                'limits':{'maxRequestBytes':65536,'maxResponseBytes':65536,'maxOutputTokens':128,'maxCalls':4,
                          'budgetTokens':4*(OPENAI_CHAT_INPUT_RESERVATION+128),'timeoutMs':15000}}
            if config['mode'] == 'live':
                api_key = os.environ.get('PSP_OPENAI_API_KEY','')
                provider_config.update(allowLive=True,apiKey=api_key)
            else: provider_config['transport'] = transport
            raw = create_openai_chat_provider(provider_config)
            def invoke(request, controls):
                nonlocal provider_calls, provider_error
                requests.append(deepcopy(request))
                provider_calls += 1
                try: return raw['invoke'](request,controls)
                except Exception as exc:
                    provider_error = getattr(exc,'code','PROVIDER_FAILED')
                    raise
            provider = {**raw,'invoke':invoke}
            peer = StdioMcpClient.connect({'executable':config['peerExecutable'],'args':[config['peerScript'],config['caseId'],spy],
                'env':environment(),'serverInfo':{'name':'psp-cdl-reference','version':'0.1.0'},'timeoutMs':30000})
            registrations = peer.registrations('study',[approval(name) for name in ('public','private')],now)
            if psp:
                backend = SqliteBackend(str(Path(directory)/'state.sqlite'),'study-epoch',now)
                store = WorkflowStore(backend,resume_secret=bytes([7])*32,authorize_persistence=lambda *_:True,coordinator=OwnerCoordinator())
                store.execute(actor,{'action':'putNode','nodeId':'study','nodeVersion':'1','definition':{'agents':','.join('mcp://study/'+t for t in data['allowedTools'])}})
                session = store.execute(actor,{'action':'createSession','requestId':'study-seed','nodeId':'study','nodeVersion':'1','policyVersion':'study-policy','expiresAt':expires,'state':{}})
                class Host:
                    def now(self): return now()
                    def authenticate(self, token):
                        return {**actor,'scopes':['tools:list','tools:call','models:invoke']} if token == 'study-token' else None
                    def snapshot(self, *_):
                        return {'revision':'study-authority','policyVersion':'study-policy','registryRevision':'study-registry','expires':expires,
                                'releaseSources':[{'id':'model','capabilities':aggregate_capabilities(config['sources'],True)}],'releaseComplete':True}
                    def policy(self, _p, binding, *_): return {'bindingDigest':binding_digest(binding),'resources':[resource([])]}
                host = Host()
                gate = McpDispatchGate(store,host,'study-registry',registrations)
                class LoopHost(Host):
                    def snapshot(self, *_):
                        return {**host.snapshot(),'providerId':provider['id'],'providerRevision':provider['revision'],
                                'releaseSources':[{'id':'display','capabilities':['can-display-to-operator']}]}
                    def prompt(self, _p, binding):
                        return sign_envelope(SYSTEM_TEXT,{'algorithm':'hmac-sha256','signatureVersion':'2.0','secretId':'study-key','timestamp':expires-120,
                            'expires':expires,'version':'1.0.0','sectionType':'system','contentType':'text','trustLevel':2,'attributes':prompt_context(binding)},key)
                    def verification(self, *_):
                        return {'keys':[{'id':'study-key','algorithm':'hmac-sha256','material':key,'status':'active','trustLevels':[2],
                                        'sectionTypes':['system'],'scope':{},'allowUnscoped':False}]}
                    def policy(self, _p, binding, payload, _phase):
                        covenants = ['no-display-to-operator'] if cdl and data['noDisplay'] and any(m['role'] == 'tool' and m['name'] == 'study.private' for m in payload['request']['messages']) else []
                        return {'bindingDigest':binding_digest(binding),'resources':[resource(covenants)]}
                    def authorize_final(self, *_): return True
                output = BufferedLlmLoop(store,gate,LoopHost(),provider).run('study-token',session['sessionId'],{'message':message(data)},options)['text']
            else: output = direct_loop(provider,registrations,data,options,cdl,now)
        except Exception as exc:
            candidate = getattr(exc,'code','ADAPTER_ERROR')
            code = candidate if isinstance(candidate,str) and len(candidate) <= 64 and all(c in 'ABCDEFGHIJKLMNOPQRSTUVWXYZ_' for c in candidate) else 'ADAPTER_ERROR'
        finally:
            try:
                if peer: peer.close()
            finally:
                if backend: backend.close()
        events = []
        try: events = read_events(spy,config['caseId'],True) if Path(spy).exists() else []
        except (ValueError,OSError,RuntimeError): code, output = 'INVALID_OBSERVATION', None
        if (not events or events[0]['kind'] != 'isolation-probes-blocked') and code == 'OK': code, output = 'ISOLATION_NOT_OBSERVED', None
        serialized = canonical_json(requests)
        private_values = ['study-tenant','study-owner','study-token','study-key',CREDENTIAL,session['sessionId'] if session else '',api_key]
        return {'code':code,'output':output,'events':events,'providerCalls':provider_calls,'providerError':provider_error,
                'requestDigest':binding_digest(requests),'authorityLeak':any(v and v in serialized for v in private_values),
                'elapsedMs':int((time.monotonic()-started)*1000+0.5)}


if __name__ == '__main__':
    try: print(json.dumps(run_trial(json.load(sys.stdin))))
    except Exception:
        print(json.dumps({'error':'ADAPTER_ERROR'}))
        raise SystemExit(1)
