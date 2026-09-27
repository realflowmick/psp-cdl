# SPDX-License-Identifier: Apache-2.0
"""Generate the separate pilot contract and synthetic analytical test vectors."""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CONDITIONS = ['unprotected','psp-only','cdl-only','combined']
LANGUAGES = ['typescript','python']
FAMILIES = ['direct-read','indirect-read','restricted-display']

def obj(properties): return {'type':'object','additionalProperties':False,'required':list(properties),'properties':properties}
def array(items, minimum, maximum): return {'type':'array','items':items,'minItems':minimum,'maxItems':maximum}
def integer(low=0, high=4096): return {'type':'integer','minimum':low,'maximum':high}
def enum(values): return {'enum':values}
def ref(name): return {'$ref':'#/$defs/'+name}

digest = {'type':'string','pattern':r'^[a-f0-9]{64}(?![\s\S])'}
identifier = {'type':'string','pattern':r'^[a-z0-9][a-z0-9_-]{0,63}(?![\s\S])'}
trial_id = {'type':'string','pattern':r'^[a-z0-9][a-z0-9_-]{0,63}/(unprotected|psp-only|cdl-only|combined)/(typescript|python)/(typescript|python)/[1-9][0-9]?(?![\s\S])'}
provenance = enum(['synthetic-fixture','unreviewed-input'])
metric = enum(['attackSuccess','benignSuccess','falseDenial'])
fraction = {'type':'number','minimum':0,'maximum':1}
difference = {'type':'number','minimum':-1,'maximum':1}
nullable_bool = {'type':['boolean','null']}
defs = {}
defs['pair'] = obj({'id':identifier,'family':enum(FAMILIES),'attackCaseId':identifier,'benignCaseId':identifier})
defs['request'] = obj({'schemaVersion':{'const':1},'manifest':obj({'provenance':provenance,'pairs':array(ref('pair'),3,24)}),
                       'pairsPerFamily':integer(1,8),'repetitions':integer(1,20),'orderSeed':integer(1,2147483647),
                       'analysisSeed':integer(1,2147483647),'bootstrapResamples':integer(200,10000)})
defs['trial'] = obj({'id':trial_id,'pairId':identifier,'caseId':identifier,'family':enum(FAMILIES),'kind':enum(['attack','benign']),
                     'condition':enum(CONDITIONS),'host':enum(LANGUAGES),'peer':enum(LANGUAGES),'repeat':integer(1,20),'topology':{'const':'B'}})
defs['plan'] = obj({'schemaVersion':{'const':1},'scope':{'const':'pilot-plan-0.1'},'status':{'const':'draft'},
                    'executionAuthorized':{'const':False},'fullStudy':{'const':False},'orderAlgorithm':{'const':'sha256-sort-0.1'},
                    'request':ref('request'),'requestSha256':digest,'trials':array(ref('trial'),96,4096),'trialsSha256':digest})
defs['row'] = obj({'trialId':trial_id,'status':enum(['observed','error','cancelled','skipped']),
                   'attackSuccess':nullable_bool,'benignSuccess':nullable_bool,'falseDenial':nullable_bool})
defs['outcomes'] = obj({'schemaVersion':{'const':1},'planSha256':digest,'provenance':provenance,'rows':array(ref('row'),96,4096)})
defs['rate'] = obj({**{key:integer() for key in ('true','false','unknown','total')},
                    'rateAmongKnown':{'anyOf':[fraction,{'type':'null'}]},'lower':fraction,'upper':fraction})
defs['conditionRates'] = array(obj({'condition':enum(CONDITIONS),'metrics':obj({m:ref('rate') for m in metric['enum']})}),4,4)
defs['interval'] = obj({'low':difference,'high':difference,'degenerate':{'type':'boolean'}})
defs['contrast'] = obj({'metric':metric,'treatment':{'const':'combined'},'control':enum(CONDITIONS[:-1]),'clusters':integer(3,24),
                        'knownDifference':{'anyOf':[difference,{'type':'null'}]},'lower':difference,'upper':difference,
                        'lowerBoundPercentile95':ref('interval'),'upperBoundPercentile95':ref('interval')})
defs['group'] = obj({'host':enum(LANGUAGES),'peer':enum(LANGUAGES),'planned':integer(24,1024),'clusters':integer(3,24),
                     'statuses':obj({s:integer() for s in ('observed','error','cancelled','skipped')}),'conditions':ref('conditionRates'),
                     'families':array(obj({'family':enum(FAMILIES),'conditions':ref('conditionRates')}),3,3),'contrasts':array(ref('contrast'),9,9)})
defs['analysis'] = obj({'schemaVersion':{'const':1},'scope':{'const':'pilot-analysis-0.1'},'provenance':provenance,
                        'fullStudy':{'const':False},'independentReview':{'const':False},'planSha256':digest,'outcomesSha256':digest,
                        'method':{'const':'paired-case-cluster-percentile-0.1'},'analysisSeed':integer(1,2147483647),
                        'bootstrapResamples':integer(200,10000),'resampleIndicesSha256':digest,'groups':array(ref('group'),4,4),
                        'limitations':array({'type':'string'},4,4)})
schema = {'$schema':'https://json-schema.org/draft/2020-12/schema','$id':'https://psp-cdl.org/schemas/pilot-0.1.schema.json',
          'title':'Offline pilot planning and exploratory analysis (CC0-1.0)','$defs':defs}

def request(pairs, repeats, resamples):
    return {'schemaVersion':1,'manifest':{'provenance':'synthetic-fixture','pairs':[
        {'id':f'{family}-{i:02}','family':family,'attackCaseId':f'{family}-{i:02}-attack','benignCaseId':f'{family}-{i:02}-benign'}
        for family in FAMILIES for i in range(1,pairs+1)]},'pairsPerFamily':pairs,'repetitions':repeats,
        'orderSeed':492026,'analysisSeed':492027,'bootstrapResamples':resamples}

cases = [
    {'id':'known-improvement','code':'OK','lower':-1,'upper':-1,'degenerate':True},
    {'id':'all-unknown','code':'OK','lower':-1,'upper':1,'degenerate':True},
    {'id':'matched-clusters','code':'OK','lower':0,'upper':0,'degenerate':True},
    {'id':'varying-clusters','code':'OK','lower':-1/3,'upper':-1/3,'degenerate':False},
    {'id':'effect-before-error','code':'OK','lower':1,'upper':1,'degenerate':True},
]
for name in ('missing-row','duplicate-row','reordered-rows','extra-row','wrong-plan-digest','wrong-provenance',
             'extra-authority','wrong-kind','error-as-defense','skipped-as-success','utility-denial-conflict'):
    cases.append({'id':name,'code':'INVALID_OUTCOMES'})
for name in ('changed-trial','rehashed-order','execution-claim'):
    cases.append({'id':name,'code':'INVALID_PLAN'})
for name in ('duplicate-case','missing-family','newline-identifier'):
    cases.append({'id':name,'code':'INVALID_MANIFEST'})
for name in ('boolean-seed','unknown-request-field'):
    cases.append({'id':name,'code':'INVALID_REQUEST'})
cases.append({'id':'trial-bound','code':'LIMIT_EXCEEDED'})
suite = {'license':'CC0-1.0','scope':'synthetic-analysis-tests-only','request':request(1,2,200),'cases':cases}
for name, value in [('schemas/pilot-0.1.schema.json',schema),('conformance/vectors/evaluation/pilot-0.1.json',suite),
                    ('conformance/vectors/evaluation/pilot-request-0.1.json',request(4,5,10000))]:
    path = ROOT/name
    text = json.dumps(value,ensure_ascii=False,indent=2)+'\n'
    if '--check' in sys.argv:
        if not path.exists() or path.read_text(encoding='utf-8') != text: raise SystemExit('Stale pilot artifact: '+name)
    else: path.write_text(text,encoding='utf-8',newline='\n')
print(f'Pilot contract and {len(cases)} explicit synthetic cases verified. No held-out data or outcomes.')
