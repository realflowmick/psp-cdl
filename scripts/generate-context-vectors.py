# SPDX-License-Identifier: Apache-2.0
"""Synthetic transport regressions, not model reasoning or effectiveness tests."""
import json
from pathlib import Path
import sys
ROOT=Path(__file__).resolve().parents[1]
application=(ROOT/'examples/in-context/application.psp').read_text(encoding='utf-8')
instructions=(ROOT/'examples/in-context/execution-boundary.txt').read_text(encoding='utf-8')
prompt=instructions+'\n\n'+application
cases=[]
for target in ('help','survey'):
    output='${psp type=context ref="application_state" content-type=json}'+json.dumps({'workflow_status':'running','current_node':target,'variables':{'approved':False,'amount':20000}},separators=(',',':'))+'${/psp}'
    cases.append({'id':'model-selects-'+target,'settings':{'promptText':prompt,'responses':[{'type':'final','text':output}]},'request':{'message':'Please review my situation.'},'expected':{'code':'OK','providerCalls':1,'toolCalls':0,'released':1},'expectedText':output})
for name,settings,code,calls in [('signature-failure',{'tamperedPrompt':True},'PROMPT_REJECTED',0),('inference-denied',{'denyPhase':'inference'},'POLICY_DENIED',0),('release-denied',{'displayDenied':True},'OUTPUT_DENIED',1)]:
    cases.append({'id':name,'settings':{'promptText':prompt,'responses':[{'type':'final','text':'model output'}],**settings},'expected':{'code':code,'providerCalls':calls,'toolCalls':0,'released':0}})
path=ROOT/'conformance/vectors/llm/in-context-0.1.json'
content=json.dumps({'license':'CC0-1.0','application':application,'cases':cases},indent=2)+'\n'
if '--check' in sys.argv:
    if path.read_text(encoding='utf-8')!=content:raise SystemExit('Context fixtures stale')
else:path.write_text(content,encoding='utf-8')
print(f'{len(cases)} in-context transport cases')
