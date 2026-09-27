# SPDX-License-Identifier: Apache-2.0
"""Actual external-corpus execution, all four language pairs, and paired regrading."""
import hashlib
import json
import subprocess
import sys
import uuid
from pathlib import Path
from psp_cdl_test_harness import grade_pilot_evidence

ROOT = Path(__file__).resolve().parents[1]
BASE = ROOT/'conformance/vectors/evaluation'
RUN = ROOT/'.artifacts'/('heldout-parity-'+uuid.uuid4().hex[:10])
RUN.mkdir(parents=True)
def read(path): return json.loads(Path(path).read_text(encoding='utf-8'))
def call(args,expected=0):
    p = subprocess.run(args,cwd=ROOT,capture_output=True,text=True,encoding='utf-8')
    if p.returncode != expected: raise AssertionError(f'Command status {p.returncode}, expected {expected}: {p.stdout} {p.stderr}')
    return json.loads(p.stdout)

corpus_path, rehearsal_path = (BASE/('heldout-'+k+'-0.1.json') for k in ('corpus','rehearsal'))
corpus, suite = read(corpus_path),read(BASE/'heldout-grading-0.1.json')
cases = {c['id']:c for c in corpus['cases']}
expected = []
for c in suite['cases']:
    try: expected.append({'code':'OK','result':grade_pilot_evidence(cases[c['caseId']],c['record'])})
    except ValueError as error: expected.append({'code':getattr(error,'code','UNEXPECTED_ERROR')})
actual = call(['node','--input-type=module','-e',"""
import {readFileSync} from 'node:fs';import {gradePilotEvidence} from '@psp-cdl/test-harness';
const load=n=>JSON.parse(readFileSync('conformance/vectors/evaluation/heldout-'+n+'-0.1.json','utf8'));
const corpus=load('corpus'),suite=load('grading');
console.log(JSON.stringify(suite.cases.map(c=>{try{return {code:'OK',result:gradePilotEvidence(corpus.cases.find(v=>v.id===c.caseId),c.record)};}catch(e){return {code:e.code??'UNEXPECTED_ERROR'};}})));
"""])
assert actual == expected,'Shared grading results differ across languages'
call(['node','scripts/pilot.mjs','plan','--request',str(BASE/'heldout-request-0.1.json'),'--output',str(RUN/'plan.json')])
call([sys.executable,'scripts/run-heldout.py','prepare','--plan',str(RUN/'plan.json'),'--corpus',str(corpus_path),
      '--rehearsal',str(rehearsal_path),'--output',str(RUN/'bundle.json')])
command = [sys.executable,'scripts/run-heldout.py','run','--bundle',str(RUN/'bundle.json'),'--corpus',str(corpus_path),'--rehearsal',str(rehearsal_path)]
summary = call(command)
assert summary['statuses'] == {'observed':96,'error':0,'cancelled':0,'skipped':0},summary
directory = Path(summary['manifest']).parent
manifest = read(directory/'manifest.json');plan = read(RUN/'plan.json');outcomes = read(directory/'outcomes.json')
assert manifest['status'] == 'finalized' and manifest['mode'] == 'offline' and manifest['fullStudy'] is False
assert manifest['usage']['coverage'] == 'complete'
assert manifest['usage']['basis'] == 'synthetic-offline'
assert manifest['usage']['actualCostUsd'] is None
assert sum(g['latencyMs']['samples'] for g in manifest['groups']) == 96
assert sum(g['latencyMs']['unobservedTrials'] for g in manifest['groups']) == 0
groups={};started=[]
for i,(trial,row) in enumerate(zip(plan['trials'],outcomes['rows'])):
    assert trial['id'] == row['trialId']
    if trial['kind'] == 'benign': assert row['benignSuccess'] is True and row['falseDenial'] is False,row
    else:
        effect = trial['condition'] in (('unprotected','psp-only') if trial['family']=='restricted-display' else ('unprotected','cdl-only'))
        assert row['attackSuccess'] == effect,row
    record=read(directory/f'{i:04d}.record.json');observation={k:v for k,v in record['observation'].items() if k!='elapsedMs'}
    assert not observation['authorityLeak']
    key=(trial['caseId'],trial['condition'],trial['repeat'])
    if key in groups: assert observation == groups[key],key
    groups[key]=observation
    started.append(read(directory/f'{i:04d}.started.json')['startedAt'])
assert started == sorted(started),'Execution did not follow pinned order'
for entry in manifest['files']: assert hashlib.sha256((directory/entry['path']).read_bytes()).hexdigest() == entry['sha256']

# Regrade the actual Python-orchestrated evidence using the installed TypeScript
# APIs, and compare every label, grading detail and complete paired analysis.
call(['node','--input-type=module','-e',"""
import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {gradePilotRecords,gradePilotEvidence,analyzePilot} from '@psp-cdl/test-harness';
import {validateHeldout} from './scripts/validate-heldout.mjs';
const folder=process.argv[1],load=n=>JSON.parse(readFileSync(folder+'/'+n,'utf8'));
const bundle=load('bundle.json'),corpus=load('corpus.json'),plan=bundle.plan;
validateHeldout('bundle',bundle);validateHeldout('corpus',corpus);
validateHeldout('manifest',load('manifest.json'));
const records=plan.trials.map((t,i)=>load(String(i).padStart(4,'0')+'.record.json'));
records.forEach((r,i)=>{validateHeldout('evidence',r);validateHeldout('grade',gradePilotEvidence(corpus.cases.find(c=>c.id===plan.trials[i].caseId),r));});
const graded=gradePilotRecords(plan,corpus,records);
assert.deepEqual(graded.outcomes,load('outcomes.json'));assert.deepEqual(graded.grading,load('grading.json'));
assert.deepEqual(analyzePilot(plan,graded.outcomes),load('analysis.json'));
console.log(JSON.stringify({regraded:true}));
""",str(directory)])
before=(directory/'manifest.json').read_bytes()
assert call(command,2)['code'] == 'INVALID_HELDOUT_INPUT_OR_STATE'
assert call([sys.executable,'scripts/run-heldout.py','finalize','--bundle',str(RUN/'bundle.json'),'--corpus',str(corpus_path)],2)['code'] == 'INVALID_HELDOUT_INPUT_OR_STATE'
assert (directory/'manifest.json').read_bytes() == before
subprocess.run([sys.executable,'scripts/check-result-parity.py','--directory',str(directory)],cwd=ROOT,check=True)
print(json.dumps({'scope':'public-synthetic-executor-validation','gradingCases':len(suite['cases']),'executedTrials':96,
                  'languagePairs':4,'fullEvidenceRegrading':True,'manifest':str(directory.relative_to(ROOT)/'manifest.json'),'fullStudy':False}))
