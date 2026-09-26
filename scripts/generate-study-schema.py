# SPDX-License-Identifier: Apache-2.0
"""Version the development report while retaining the archived 0.1 contract."""
import json
import sys
from copy import deepcopy
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
schema = json.loads((ROOT/'schemas/study-0.1.schema.json').read_text(encoding='utf-8'))
schema['$id'] = 'https://psp-cdl.org/schemas/study-0.2.schema.json'
schema['title'] = 'Development study 0.2: host usage observations (CC0-1.0)'
integer = {'type':'integer','minimum':0}
event = {'type':'object','additionalProperties':False,'required':['attempt','promptTokens','completionTokens','totalTokens'],
         'properties':{'attempt':{'type':'integer','minimum':1,'maximum':4},
                       'promptTokens':{**integer,'maximum':1047576},'completionTokens':{**integer,'maximum':128},
                       'totalTokens':{**integer,'maximum':1047704}}}
schema['$defs']['providerUsage'] = {'type':'array','maxItems':4,'items':event}
for observation in (schema['$defs']['observation'],schema['$defs']['result']['properties']['observation']):
    observation['required'].append('providerUsage')
    observation['properties']['providerUsage'] = {'$ref':'#/$defs/providerUsage'}
for kind in ('plan','report'): schema['$defs'][kind]['properties']['schemaVersion'] = {'const':2}
usage = schema['$defs']['report']['properties']['usage']
usage['required'].remove('actualTokens')
del usage['properties']['actualTokens']
properties = {
    'basis':{'enum':['synthetic-offline','provider-reported']},
    'responsesWithUsage':integer,'attemptsWithoutUsage':integer,
    'coverage':{'enum':['complete','partial']},
    'reportedTokens':{'type':'object','additionalProperties':False,'required':['promptTokens','completionTokens','totalTokens'],
                      'properties':{key:integer for key in ('promptTokens','completionTokens','totalTokens')}},
    'reportedUsageCostUpperEstimateMicroUsd':{'anyOf':[integer,{'type':'null'}]},
}
usage['required'].extend(properties)
usage['properties'].update(deepcopy(properties))
path = ROOT/'schemas/study-0.2.schema.json'
text = json.dumps(schema,ensure_ascii=False,indent=2)+'\n'
if '--check' in sys.argv:
    if path.read_text(encoding='utf-8') != text: raise SystemExit('Stale study 0.2 schema')
else: path.write_text(text,encoding='utf-8')
print('Study 0.2 schema verified; 0.1 retained.')
