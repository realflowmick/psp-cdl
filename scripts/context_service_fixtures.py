# SPDX-License-Identifier: Apache-2.0
"""Public synthetic host. No live model calls or production credentials."""
import json
from pathlib import Path
from types import SimpleNamespace
from llm_fixtures import Fixture
from psp_cdl_api_server.workflow import WorkflowService
from psp_cdl_api_server.persistence import WorkflowStore
from psp_cdl_llmproxy import ContextLlmLoop, CONTEXT_SERVICE_PROFILE
from psp_cdl_mcpproxy import binding_digest
ROOT=Path(__file__).resolve().parents[1]
SUITE=json.loads((ROOT/'conformance/vectors/llm/context-service-0.1.json').read_text(encoding='utf-8'))
CONFIGURATION={'profile':CONTEXT_SERVICE_PROFILE,
    'pspInstructions':(ROOT/'specs/systemprompts/PSP-Core-v3_2_0-Interpreter-draft-0_1.md').read_text(encoding='utf-8'),
    'cdlInstructions':(ROOT/'specs/systemprompts/CDL-v1_5-Interpreter-draft-0_1.md').read_text(encoding='utf-8'),
    'application':(ROOT/'examples/in-context/application.psp').read_text(encoding='utf-8'),
    'serviceSources':[{'id':'workflow','capabilities':[]}],'serviceComplete':True}

def run_case(case):
    flags=case.get('flags',{})
    responses=[{'type':'final','text':p if type(p) is str else json.dumps(p,separators=(',',':'))} for p in case['proposals']]
    if flags.get('readFirst'):responses.insert(0,{'type':'tool','name':'echo.read','arguments':{'message':'synthetic read'}})
    if flags.get('resume'):responses.append({'type':'final','text':json.dumps({'type':'answer','text':'Resumed from the persisted state.'})})
    f=Fixture({**flags,'responses':responses})
    base=f.base
    tokens={}
    code='OK'
    try:
        for node in ('help','survey'):base.store.execute(base.actor,{'action':'putNode','nodeId':node,'nodeVersion':'1','definition':{'agents':'mcp://echo/read','instructions':'Keep full application context.'}})
        base.flags['denyPersistence']=bool(flags.get('denyPersistence'))
        def authenticate(token):
            p=f.authenticate(token)
            return {**p,'scopes':[*p['scopes'],'sessions:read','sessions:write','nodes:read','checkpoints:write','checkpoints:resume']} if p else None
        def sign_context(p,b,text):
            f.flags['promptText']=text
            return f.prompt(p,b)
        def policy(p,b,d,phase):
            if flags.get('denyService') and d.get('service'):
                return {'bindingDigest':binding_digest(b),'resources':[{'classes':[],'covenants':['no-persist'],'capabilities':[],'checks':{},'parameters':{},'context':{}}]}
            return f.policy(p,b,d,phase)
        host=SimpleNamespace(**{k:getattr(f,k) for k in ('now','snapshot','verification','authorize_final')},authenticate=authenticate,sign_context=sign_context,policy=policy)
        def authorize(_p,context):
            c=context['command']
            if flags.get('resumeDenied') and c['action']=='resumeCheckpoint':return False
            if c['action']=='updateSession':
                if flags.get('revokeService'):base.flags['revoked']=True
                if flags.get('cancelService'):base.flags['cancelled']=True
                if flags.get('driftService'):base.flags['drift']=True
                if flags.get('raceService'):
                    other=WorkflowStore(base.backend,resume_secret=bytes([7])*32,authorize_persistence=lambda *_:True)
                    other.execute(base.actor,{'action':'updateSession','requestId':'other-worker','sessionId':base.session['sessionId'],'expectedVersion':1,'nodeId':'entry','nodeVersion':'1','policyVersion':'policy-1','status':'running','state':{'stage':'concurrent'}})
                if flags.get('denyWrite') or flags.get('denyHelp') and c['nodeId']=='help':return False
            return True
        def present(_p,operation,data):
            if flags.get('projectionFail') and operation=='updateSession':raise ValueError('PRIVATE_SERVICE_DETAIL')
            return data
        def deliver(_p,data):
            if flags.get('deliverFail'):raise ValueError('PRIVATE_SERVICE_DETAIL')
            tokens[data['checkpointId']]=data['resumeToken']
            if flags.get('driftDelivery'):base.flags['drift']=True
        service=WorkflowService(base.store,SimpleNamespace(**vars(host),resolve=lambda *_:None,policy_version=lambda *_:'policy-1',authorize=authorize,present=present,deliver_checkpoint=deliver,resume_token=lambda p,k:tokens.get(k)))
        def make():return ContextLlmLoop(base.store,base.gate,host,f.provider,service,CONFIGURATION)
        result=make().run('test-owner',base.session['sessionId'],{'message':'Please review my situation.'},{**f.options,'requestId':'context-turn','maxRounds':flags.get('maxRounds',4)})
        if flags.get('resume'):
            state=base.store.execute(base.actor,{'action':'getSession','sessionId':base.session['sessionId']})
            result=make().resume_and_run('test-owner','wrong-session' if flags.get('resumeWrongSession') else base.session['sessionId'],{'requestId':'host-resume','checkpointId':result['receipt']['result']['result']['checkpointId'],'state':state['state']},{'message':'Continue after the approved resume.'},{**f.options,'requestId':'resumed-turn','maxRounds':4})
    except Exception as exc:code=getattr(exc,'code','UNEXPECTED_ERROR')
    try:
        state=base.backend.read(base.actor['tenantId'],{'kind':'session','id':base.session['sessionId']})['body']
        last=f.requests[-1] if f.requests else {'messages':[]}
        events=[]
        rehydrated=False
        for m in last['messages']:
            if m['role']=='user':
                try:
                    value=json.loads(m['content'])
                    if value.get('event','').startswith('service-'):events.append(value['event'])
                    if value.get('event')=='session-view' and value['data']['result']['version']==4 and value['data']['result']['view'].get('current_node')=='help':rehydrated=True
                except (ValueError,TypeError):pass
        wire=json.dumps(f.requests)
        return {'code':code,'calls':len(f.requests),'toolCalls':base.calls,'version':state['version'],'node':state['nodeId'],'status':state['status'],'state':state['state'],'events':events,'rehydrated':rehydrated,
                'hasCandidates':all(CONFIGURATION['pspInstructions'] in r['messages'][0]['content'] and CONFIGURATION['cdlInstructions'] in r['messages'][0]['content'] and r['messages'][0]['content'].endswith(CONFIGURATION['application']) for r in f.requests),
                'hasToolHistory':any(m['role']=='tool' for m in last['messages']),
                'privateLeak':any(s in wire for s in ('test-owner','test-signing-key','tenant-a','subject-a','PRIVATE_SERVICE_DETAIL',*tokens.values()))}
    finally:f.close()
