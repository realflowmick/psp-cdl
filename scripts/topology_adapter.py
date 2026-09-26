# SPDX-License-Identifier: Apache-2.0
"""Independent offline A/B/C orchestration and observation adapter."""
import json
import os
import sys
import tempfile
import time
from copy import deepcopy
from pathlib import Path
from llm_fixtures import Fixture
from psp_cdl_llmproxy import BufferedLlmLoop, prompt_context
from psp_cdl_mcpproxy import McpDispatchGate, binding_digest
from psp_cdl_mcpproxy.mcp import StdioMcpClient
from psp_cdl_core.crypto import sign_envelope
from psp_cdl_cdl import tokenize_declaration
from topology_common import SUITE, CREDENTIAL, approval, environment, read_events, close_approval


class DirectError(Exception):
    def __init__(self, code): self.code = code


def run_direct(provider, registrations, message, options):
    """No PSP/CDL decision point. A host-owned provider callback drives this loop."""
    def check():
        if options['cancelled'](): raise DirectError('CANCELLED')
    messages = [{'role':'system','content':'Use the synthetic read tool when needed.'},{'role':'user','content':message}]
    tools = [{'name':r['server']+'.'+r['name'],'inputSchema':r['inputSchema'],'outputSchema':r['outputSchema']} for r in registrations]
    for _ in range(options['maxSteps']):
        check()
        result = provider['invoke'](deepcopy({'messages':messages,'tools':tools}),options)
        check()
        if type(result) is not dict: raise DirectError('INVALID_RESPONSE')
        if result.get('type') == 'final' and isinstance(result.get('text'),str): return result['text']
        tool = next((r for r in registrations if r['server']+'.'+r['name'] == result.get('name')),None)
        if result.get('type') != 'tool' or tool is None or type(result.get('arguments')) is not dict: raise DirectError('INVALID_RESPONSE')
        try: data = tool['invoke'](result['arguments'],options)
        except Exception:
            check()
            raise
        check()
        messages.extend([{'role':'assistant','call':{'name':result['name'],'arguments':result['arguments']}},{'role':'tool','name':result['name'],'data':data}])
    raise DirectError('STEP_LIMIT')


def run_case(case, topology, server_executable, server_script, proxy_executable, proxy_script):
    with tempfile.TemporaryDirectory(prefix='psp-topology-') as directory:
        spy, proxy_spy = str(Path(directory)/'server.jsonl'), str(Path(directory)/'proxy.jsonl')
        through_proxy = topology == 'C' and case['kind'] != 'bypass'
        def events(complete=False): return read_events(spy,case['id'],complete)
        peer = f = None
        try:
            data, p = case['input'], case['input']['perturbation']
            terms = tokenize_declaration(data['declaration']) if 'declaration' in data else []
            f = Fixture({'base':{'agents':','.join(data['agents'])},'providerCancel':p == 'cancel-before-dispatch','bypassWrite':p == 'stale-state',
                'displayDenied':p == 'display-denial','providerTraining':p == 'inference-denial','tamperedPrompt':p == 'tampered-prompt','expiredPrompt':p == 'expired-prompt',
                'responses':[{'type':'tool','name':data['requestedAgent'].removeprefix('mcp://').replace('/','.'),'arguments':{'recordId':data['recordId'],**data.get('extraArguments',{})}},{'type':'final','text':'unused'}]})
            peer = StdioMcpClient.connect({'executable':proxy_executable if through_proxy else server_executable,
                'args':[proxy_script,case['id'],server_executable,server_script,spy,proxy_spy] if through_proxy else [server_script,topology,case['id'],spy],
                'env':environment(),'serverInfo':{'name':'psp-cdl-reference','version':'0.1.0'},'timeoutMs':8000})
            names = ['allowed','other'] + (['export'] if topology == 'A' or case['kind'] == 'bypass' else [])
            registrations = peer.registrations('reference',[approval(name,data['capabilities']) for name in names],f.base.now)
            control = peer.registrations('fixture-control',[close_approval()],f.base.now)[0] if through_proxy else None
            if through_proxy and p == 'cancel-after-read':
                for r in registrations:
                    original = r['invoke']
                    r['invoke'] = lambda args,options,invoke=original:invoke(args,{**options,'cancelled':lambda:False})
            policy = f.base.policy
            def dispatch_policy(*args):
                result = policy(*args)
                result['resources'][0]['covenants'] = data['covenants']
                return result
            f.base.policy = dispatch_policy
            if data.get('kid'):
                f.prompt = lambda _p,b:sign_envelope('Use the synthetic read tool when needed.',
                    {'algorithm':'ed25519','signatureVersion':'2.0','kid':data['kid'],'timestamp':900,'expires':1700,'version':'1.0.0','sectionType':'system','contentType':'text','trustLevel':2,'attributes':prompt_context(b)},bytes([19])*32)
                f.verification = lambda *_:{'keys':data['trustedKeys']}
            invoke = f.provider['invoke']
            def provider_invoke(request, options):
                response = invoke(request,options)
                if response['type'] == 'final':
                    message = next(m for m in reversed(request['messages']) if m['role'] == 'tool')
                    return {'type':'final','text':message['data']['message']}
                return response
            provider = {**f.provider,'invoke':provider_invoke}
            gate = McpDispatchGate(f.base.store,f.base,'registry-1',[r for r in registrations if r['readOnly']])
            loop = BufferedLlmLoop(f.base.store,gate,f,provider)
            options = {**f.options,'cancelled':lambda:bool(f.base.flags.get('cancelled')) or p == 'cancel-after-read' and
                (any(e['kind'] == 'proxy-release' for e in read_events(proxy_spy,case['id'])) if through_proxy else any(e['kind'] == 'read' for e in events()))}
            codes, outputs = [], []
            message = json.dumps({'message':SUITE['configuration']['userMessage'],'agents':data['agents'],'toolCapabilities':data['capabilities'],'covenants':data['covenants'],'lexicalTerms':terms},separators=(',',':'))
            def attempt():
                try:
                    if topology == 'A': outputs.append(run_direct(provider,registrations,message,options))
                    else:
                        result = loop.run(data['token'],f.base.session['sessionId'],{'message':message},options)
                        if result['provenance']['trustLevel'] != 5 or result['provenance']['outputDigest'] != binding_digest({'text':result['text']}): raise RuntimeError('INVALID_PROVENANCE')
                        outputs.append(result['text'])
                    codes.append('OK')
                except Exception as exc:
                    if not hasattr(exc,'code'): raise
                    codes.append(exc.code)
            if case['kind'] == 'bypass':
                output = next(r for r in registrations if r['name'] == 'export')['invoke']({'recordId':data['recordId']},options)
                codes.append('OK')
                outputs.append(output['message'])
            elif p == 'replay-old-prompt':
                captured = None
                prompt = f.prompt
                def capture(*args):
                    nonlocal captured
                    captured = prompt(*args)
                    return captured
                f.prompt = capture
                attempt()
                f.prompt = lambda *_:captured
                f.base.update()
                attempt()
            else: attempt()
            state = f.base.store.execute(f.base.actor,{'action':'getSession','sessionId':f.base.session['sessionId']})
            if control and not Path(spy+'.closed').exists(): control['invoke']({},{**options,'cancelled':lambda:False})
            peer.close()
            peer = None
            if through_proxy:
                for _ in range(100):
                    if Path(spy+'.closed').exists(): break
                    time.sleep(.02)
                if not Path(spy+'.closed').exists(): raise RuntimeError('SERVER_CLEANUP_FAILED')
            observed = events(True)
            proxy_events = read_events(proxy_spy,case['id'],True) if through_proxy else []
            if observed[0]['kind'] != 'isolation-probes-blocked' or through_proxy and proxy_events[0]['kind'] != 'isolation-probes-blocked': raise RuntimeError('ISOLATION_NOT_OBSERVED')
            secrets = ['test-owner','test-tenant','tenant-a','subject-a','test-signing-key',CREDENTIAL,f.base.session['sessionId'],'sessionVersion','fixture_close']
            return {'codes':codes,'terms':terms,'providerCalls':len(f.requests),'events':observed,'proxyEvents':proxy_events,'outputs':outputs,
                'providerToolMessages':[m['data']['message'] for r in f.requests for m in r['messages'] if m['role'] == 'tool'],
                'sessionVersion':None if topology == 'A' else state['version'],'authorityLeak':any(v in json.dumps(f.requests) for v in secrets)}
        finally:
            try:
                if peer: peer.close()
            finally:
                if f: f.close()


if __name__ == '__main__':
    topology, *args = sys.argv[1:]
    report = []
    for case in SUITE['cases']:
        if case['expected'][topology] is None: continue
        try: report.append({'id':case['id'],'observation':run_case(case,topology,*args)})
        except Exception as exc:
            report.append({'id':case['id'],'error':'ADAPTER_ERROR'})
            if os.environ.get('PSP_MATRIX_DEBUG') == '1': print(case['id'],type(exc).__name__,str(exc),file=sys.stderr)
    print(json.dumps(report))
