# SPDX-License-Identifier: Apache-2.0
"""Authoring-time expectations; never derive expectations from adapter output."""
import argparse
import copy
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PUBLIC, CANARY = 'Synthetic public report', 'PSP_SYNTHETIC_SECRET_39'


def event(kind, record=None, code=None): return {'kind':kind,'recordId':record,'code':code}


def observed(code='OK', calls=2, read=True, outputs=None, tool=None, version=1, export=False, record='public', terms=None):
    return {'codes':[code] if isinstance(code,str) else code,'terms':terms or [],'providerCalls':calls,
        'events':[event('isolation-probes-blocked')]+([event('read',record)] if read else [])+([event('export',record)] if export else []),
        'proxyEvents':[],'outputs':[PUBLIC] if outputs is None else outputs,'providerToolMessages':[PUBLIC] if tool is None else tool,
        'sessionVersion':version,'authorityLeak':False}


def generate():
    previous = json.loads((ROOT/'conformance/vectors/topologies/matrix-0.1.json').read_text(encoding='utf-8'))
    base = copy.deepcopy(previous['cases'][2]['input'])
    cases = []
    for old in previous['cases']:
        if old['kind'] == 'blocked': continue
        b = {**old['expected'],'terms':[],'proxyEvents':[],'events':[{**e,'code':None} for e in old['expected']['events']]}
        cases.append({'id':old['id'],'kind':old['kind'],'seed':old['seed'],'input':old['input'],'expected':{'B':b},'unavailable':{}})
    def add(id, b, seed=None, **input):
        cases.append({'id':id,'kind':'workflow','seed':seed,'input':{**base,**input},'expected':{'B':b},'unavailable':{}})
    add('seed-lexical-declaration',observed(terms=['pii','no-training']),seed='CDL-002',declaration='PII no-training')
    add('lexical-array-equivalence',observed(terms=['pii','no-training']),declaration=['PII','','no-training','pii'])
    add('inference-denial',observed('POLICY_DENIED',0,False,[],[]),perturbation='inference-denial')
    add('tampered-prompt',observed('PROMPT_REJECTED',0,False,[],[]),perturbation='tampered-prompt')
    add('expired-prompt',observed('PROMPT_REJECTED',0,False,[],[]),perturbation='expired-prompt')
    add('forged-tool-authority',observed('INVALID_ARGUMENTS',1,False,[],[]),extraArguments={'tenantId':'other'})
    add('proxy-policy-denial',observed(),perturbation='proxy-policy-denial')
    add('proxy-affinity-denial',observed(),perturbation='proxy-affinity-denial',agents=['mcp://reference/allowed','mcp://reference/other'],requestedAgent='mcp://reference/other')
    add('server-output-denial',observed(outputs=[CANARY],tool=[CANARY],record='restricted'),perturbation='server-output-denial',recordId='restricted')
    for c in cases:
        a, b = copy.deepcopy(c['expected']['B']), c['expected']['B']
        if c['id'] in ('tenant-substitution','stale-state','replay-old-prompt'):
            a = None
            c['unavailable']['A'] = 'The direct adapter has no authenticated PSP session or durable version to substitute, update or replay.'
        elif c['id'] in ('seed-cdl-conflict','seed-affinity-denied','seed-unknown-key','inference-denial','tampered-prompt','expired-prompt'):
            a = observed()
        elif c['id'] == 'display-denial': a = observed(outputs=[CANARY],tool=[CANARY],record='restricted')
        elif c['id'] == 'export-denied': a = observed(read=False,export=True,outputs=[CANARY],tool=[CANARY],record='restricted')
        elif c['id'] == 'forged-tool-authority': a = observed('REMOTE_ERROR',1,False,[],[])
        if a is not None: a['sessionVersion'] = None
        chain = copy.deepcopy(b)
        if c['kind'] != 'bypass': chain['proxyEvents'] = [event('isolation-probes-blocked')]
        if c['id'] in ('proxy-policy-denial','proxy-affinity-denial'):
            chain = observed('TOOL_FAILED',1,False,[],[])
            chain['proxyEvents'] = [event('isolation-probes-blocked'),event('proxy-dispatch','public'),event('proxy-denied','public','POLICY_DENIED' if c['id']=='proxy-policy-denial' else 'TOOL_NOT_ALLOWED')]
        elif c['id'] == 'server-output-denial':
            chain = observed('TOOL_FAILED',1,True,[],[],record='restricted')
            chain['events'].append(event('server-output','restricted','DENY'))
            chain['proxyEvents'] = [event('isolation-probes-blocked'),event('proxy-dispatch','restricted'),event('proxy-denied','restricted','TOOL_FAILED')]
        elif any(e['kind'] in ('read','export') for e in chain['events']):
            record = c['input']['recordId']
            chain['events'].append(event('server-output',record,'ALLOW'))
            if c['kind'] != 'bypass': chain['proxyEvents'] += [event('proxy-dispatch',record),event('proxy-release',record,'ALLOW')]
        c['expected'] = {'A':a,'B':b,'C':chain}
    return {'license':'CC0-1.0','profile':'PSP-WORKFLOW-MATRIX-0.2','configuration':{
        'userMessage':'Read the synthetic report.','provider':'scripted-read-then-echo','clock':1000,'deadline':1800,'maxSteps':4,
        'transport':'stdio','peerMode':'dedicated-fixture','serverPolicy':'no-training','proxyAgents':['mcp://reference/allowed'],
        'profiles':['PSP-LLM-LOOP-0.1','PSP-MCP-DISPATCH-0.1','CDL-DETERMINISTIC-1.0','PSP-SIGNATURE-2.0','PSP-TRUST-1.0'],
        'aScope':'unmediated orchestration control; no deterministic-profile or semantic-effectiveness claim'},'cases':cases}


def write_or_check(path, data, check):
    if check:
        assert json.loads(path.read_text(encoding='utf-8')) == data, 'Stale topology vectors'
    else: path.write_text(json.dumps(data,indent=2,ensure_ascii=False)+'\n',encoding='utf-8',newline='\n')


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--check',action='store_true')
    args = parser.parse_args()
    write_or_check(ROOT/'conformance/vectors/topologies/matrix-0.2.json',generate(),args.check)
