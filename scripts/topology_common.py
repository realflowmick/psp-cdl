# SPDX-License-Identifier: Apache-2.0
import json
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SUITE = json.loads((ROOT / 'conformance/vectors/topologies/matrix-0.2.json').read_text(encoding='utf-8'))
RECORDS = json.loads((ROOT / 'conformance/vectors/evaluation/servers-0.1.json').read_text(encoding='utf-8'))
CREDENTIAL = 'synthetic-fixture-credential'


def environment():
    return {**({'SystemRoot':os.environ['SystemRoot']} if 'SystemRoot' in os.environ else {}),'PSP_FIXTURE_CREDENTIAL':CREDENTIAL}


def resource(covenants, capabilities=None):
    return {'classes':[],'covenants':covenants,'capabilities':capabilities or [],'checks':{},'parameters':{},'context':{}}


def approval(name, capabilities=None):
    return {'name':name,'revision':'1','readOnly':name != 'export','complete':True,
        'sources':[{'id':'host-fixture-registry','capabilities':capabilities or []}],
        'inputSchema':RECORDS['inputSchema'],'outputSchema':RECORDS['outputSchema']}


def case_by_id(case_id):
    return next(c for c in SUITE['cases'] if c['id'] == case_id)


def close_approval():
    return {**approval('fixture_close'),'readOnly':False,'inputSchema':{'type':'object','properties':{},'additionalProperties':False},
        'outputSchema':{'type':'object','properties':{'closed':{'type':'boolean'}},'required':['closed'],'additionalProperties':False}}


class EventLog:
    def __init__(self, path, correlation):
        self.file = open(path,'x',encoding='utf-8',newline='\n')
        self.correlation, self.sequence = correlation, 0
    def write(self, kind, record_id=None, code=None):
        if self.sequence >= 128: raise RuntimeError('EVENT_LIMIT')
        self.sequence += 1
        self.file.write(json.dumps({'sequence':self.sequence,'correlation':self.correlation,'kind':kind,'recordId':record_id,'code':code})+'\n')
        self.file.flush()
    def close(self): self.file.close()


def read_events(path, correlation, complete=False):
    path = Path(path)
    text = path.read_text(encoding='utf-8') if path.exists() else ''
    if complete and (not text or not text.endswith('\n')): raise RuntimeError('INCOMPLETE_EVENT_LOG')
    events = [json.loads(line) for line in text.split('\n')[:-1]]
    if any(e['sequence'] != i+1 or e['correlation'] != correlation for i,e in enumerate(events)):
        raise RuntimeError('INVALID_EVENT_LOG')
    return [{k:e[k] for k in ('kind','recordId','code')} for e in events]
