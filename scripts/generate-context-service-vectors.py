# SPDX-License-Identifier: Apache-2.0
"""Shared scripted transport cases, not model-behavior grades."""
import json
from pathlib import Path
import sys
ROOT=Path(__file__).resolve().parents[1]
def save(node):
    return {'type':'service','operation':'updateSession','arguments':{'nodeId':node,'nodeVersion':'1','state':{'current_node':node,'variables':{'approved':False,'amount':20000},'history':[{'node':'entry','status':'completed'}],'governance':{'x-cdl-covenants':'no-training'}}}}
answer={'type':'answer','text':'Observed the actual service result.'}
checkpoint={'type':'service','operation':'createCheckpoint','arguments':{'expiresAt':1600}}
fetch={'type':'service','operation':'getNode','arguments':{'nodeId':'help','nodeVersion':'1'}}
cases=[]
def case(name, proposals, expected, flags=None):
    cases.append({'id':name,'proposals':proposals,'flags':flags or {},'expected':expected})
for node in ('help','survey'):
    case('model-selects-'+node,[save(node),answer],{'code':'OK','calls':2,'version':2,'node':node,'events':['service-result'],'hasCandidates':True,'privateLeak':False})
case('host-denies-then-model-chooses-alternative',[save('help'),save('survey'),answer],{'code':'OK','calls':3,'version':2,'node':'survey','events':['service-denied','service-result']},{'denyHelp':True})
case('persistence-denial-visible',[save('help'),answer],{'code':'OK','calls':2,'version':1,'node':'entry','events':['service-denied']},{'denyPersistence':True})
case('node-fetch-result',[fetch,answer],{'code':'OK','calls':2,'version':1,'events':['service-result']})
case('missing-node-denial',[{'type':'service','operation':'getNode','arguments':{'nodeId':'missing','nodeVersion':'1'}},answer],{'code':'OK','calls':2,'events':['service-denied']})
case('checkpoint-stops-inference',[checkpoint,answer],{'code':'OK','calls':1,'version':2,'status':'waiting','privateLeak':False})
case('checkpoint-resume-rehydrates',[save('help'),checkpoint],{'code':'OK','calls':3,'version':4,'status':'running','node':'help','rehydrated':True,'privateLeak':False,'events':['service-result']},{'resume':True})
case('checkpoint-resume-denied',[save('help'),checkpoint],{'code':'AUTHORIZATION_DENIED','calls':2,'version':3,'status':'waiting'},{'resume':True,'resumeDenied':True})
case('checkpoint-resume-session-mismatch',[save('help'),checkpoint],{'code':'AUTHORIZATION_DENIED','calls':2,'version':3,'status':'waiting'},{'resume':True,'resumeWrongSession':True})
case('checkpoint-delivery-failure-not-rollback',[checkpoint,answer],{'code':'CHECKPOINT_DELIVERY_FAILED','calls':1,'version':2,'status':'waiting'},{'deliverFail':True})
case('checkpoint-release-drift-not-rollback',[checkpoint,answer],{'code':'STALE_AUTHORITY','calls':1,'version':2,'status':'waiting'},{'driftPhase':'release'})
case('checkpoint-release-denial-not-rollback',[checkpoint,answer],{'code':'OUTPUT_DENIED','calls':1,'version':2,'status':'waiting'},{'displayDenied':True})
case('projection-failure-after-commit-stops',[save('help'),answer],{'code':'INTERNAL_ERROR','calls':1,'version':2},{'projectionFail':True})
case('forged-authority-field',[{**save('help'),'arguments':{**save('help')['arguments'],'sessionId':'other'}}],{'code':'INVALID_RESPONSE','version':1})
case('unsupported-model-resume',[{'type':'service','operation':'resumeCheckpoint','arguments':{}}],{'code':'UNSUPPORTED_SERVICE','version':1})
case('unsupported-model-completion',[{**save('help'),'arguments':{**save('help')['arguments'],'status':'completed'}}],{'code':'INVALID_RESPONSE','version':1})
case('malformed-response',['not JSON'],{'code':'INVALID_RESPONSE','version':1})
case('prompt-tamper',[answer],{'code':'PROMPT_REJECTED','calls':0,'version':1},{'tamperedPrompt':True})
case('inference-policy-denial',[answer],{'code':'POLICY_DENIED','calls':0},{'denyPhase':'inference'})
case('answer-release-denial',[answer],{'code':'OUTPUT_DENIED','calls':1},{'displayDenied':True})
case('transcript-policy-before-service-write',[save('help'),answer],{'code':'POLICY_DENIED','version':1,'calls':1},{'denyService':True})
case('service-authority-denial',[save('help'),answer],{'code':'OK','version':1,'events':['service-denied']},{'denyWrite':True})
case('revocation-during-service-authorization',[save('help'),answer],{'code':'UNAUTHENTICATED','version':1},{'revokeService':True})
case('cancellation-during-service-authorization',[save('help'),answer],{'code':'CANCELLED','version':1},{'cancelService':True})
case('authority-drift-during-service-authorization',[save('help'),answer],{'code':'STALE_AUTHORITY','version':1},{'driftService':True})
case('competing-writer-before-commit',[save('help'),answer],{'code':'STALE_SESSION','version':2,'node':'entry','state':{'stage':'concurrent'}},{'raceService':True})
case('denied-receipt-ingress',[save('help'),answer],{'code':'POLICY_DENIED','calls':1,'version':2},{'denyNextInference':True})
case('round-limit-before-write',[save('help')],{'code':'ROUND_LIMIT','version':1,'calls':1},{'maxRounds':1})
case('missing-model-scope',[answer],{'code':'FORBIDDEN','calls':0},{'noModelScope':True})
case('read-tool-and-service-history',[save('survey'),answer],{'code':'OK','calls':3,'toolCalls':1,'version':2,'hasToolHistory':True},{'readFirst':True})
path=ROOT/'conformance/vectors/llm/context-service-0.1.json'
content=json.dumps({'license':'CC0-1.0','profile':'PSP-CONTEXT-SERVICE-0.1','evidence':'scripted-provider transport; no model reasoning measured','cases':cases},indent=2)+'\n'
if '--check' in sys.argv:
    assert path.read_text(encoding='utf-8')==content,'Context/service vectors stale'
else:path.write_text(content,encoding='utf-8')
print(f'{len(cases)} context/service cases')
