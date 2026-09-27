# SPDX-License-Identifier: Apache-2.0
"""Generate public audit scenarios and report schema; never generate study evidence."""
import argparse
import json
from pathlib import Path
from psp_cdl_core import canonical_json
from psp_cdl_test_harness import create_pilot_plan, validate_heldout_corpus, grade_pilot_records, analyze_pilot, pilot_digest

ROOT = Path(__file__).resolve().parents[1]
BASE = ROOT/'conformance/vectors/evaluation'


def artifacts(plan, corpus, records):
    graded = grade_pilot_records(plan,corpus,records)
    return {name:canonical_json(value) for name,value in (
        ('outcomes.json',graded['outcomes']),('grading.json',graded['grading']),('analysis.json',analyze_pilot(plan,graded['outcomes'])))}


def generate():
    plan = create_pilot_plan(json.loads((BASE/'heldout-request-0.1.json').read_text()))
    corpus = validate_heldout_corpus(plan,json.loads((BASE/'heldout-corpus-0.1.json').read_text()))
    bundle = dict(schemaVersion=1,scope='heldout-execution-0.1',plan=plan,planSha256=pilot_digest(plan),corpusSha256=pilot_digest(corpus),
                  mode='offline',evidencePolicy='local-synthetic-raw-0.1')
    files = {'bundle.json':canonical_json(bundle),'corpus.json':canonical_json(corpus)}
    records = []
    def log(trial):
        return ''.join(canonical_json(dict(sequence=i+1,correlation=trial['id'],**e))+'\n' for i,e in enumerate([
            dict(kind='isolation-probes-blocked',recordId=None,code=None),dict(kind='read',recordId='private',code=None)]))
    for i,t in enumerate(plan['trials']):
        record = dict(trialId=t['id'],completion='skipped',observation=None,observedReads=[])
        if i < 6:
            stem = f'{i:04d}'
            files[stem+'.started.json'] = canonical_json(dict(trialId=t['id'],startedAt=1000+i+.25))
            record['completion'] = 'error'
            if i in (0,2):
                obs = dict(code='POLICY_DENIED',output=None,events=[dict(kind='isolation-probes-blocked',recordId=None,code=None)],
                           providerCalls=1,providerUsage=[],providerError=None,requestDigest='1'*64,authorityLeak=False,elapsedMs=1)
                record.update(completion='returned',observation=obs)
                if i == 0: files[stem+'.record.json'] = canonical_json(record)
                else: files[stem+'.observation.json'] = canonical_json(dict(trialId=t['id'],observation=obs))
            elif i == 1:
                record.update(completion='cancelled',observedReads=['private'])
                files[stem+'.record.json'] = canonical_json(record)
            elif i == 3:
                record['observedReads'] = ['private']
                files[stem+'.events.jsonl'] = log(t)+'{"incomplete":'
            elif i == 4: files[stem+'.events.jsonl'] = '{invalid}\n'
        records.append(record)
    files.update(artifacts(plan,corpus,records))
    cases = []
    def case(id, code='OK', **values): cases.append(dict(id=id,expectedCode=code,**values))
    case('mixed-recovery',expectedStatus='reproduced')
    case('source-drift-preserved',runStatus='invalid-source-changed',expectedStatus='reproduced')
    case('recovery-flag-preserved',recovered=True,expectedStatus='reproduced')
    # No collection took place: all planned trials remain skipped and unknown.
    skipped = [dict(trialId=t['id'],completion='skipped',observation=None,observedReads=[]) for t in plan['trials']]
    case('all-unstarted',patches={**{k:None for k in files if k[:4].isdigit()},**artifacts(plan,corpus,skipped)},expectedStatus='reproduced')
    for name in ('outcomes.json','grading.json','analysis.json'):
        changed = json.loads(files[name]);changed['schemaVersion'] = 99
        case('resigned-'+name[:-5],patches={name:canonical_json(changed)},expectedStatus='mismatch',mismatches=[name])
    case('equivalent-json-format',patches={'outcomes.json':json.dumps(json.loads(files['outcomes.json']),indent=2)+'\n'},expectedStatus='reproduced')
    case('record-precedence',patches={'0000.observation.json':'null'},expectedStatus='reproduced')
    case('ignored-summary-not-audited',sourceSummary={'usage':{'fabricated':True}},expectedStatus='reproduced')
    case('artifact-byte-tamper','RESULT_ARTIFACT_MISMATCH',tamper='outcomes.json')
    case('revoked-key','REVOKED_RESULT_KEY',policy={'status':'revoked'})
    case('wrong-bundle-trust','RESULT_SCOPE_MISMATCH',policy={'bundleSha256':'0'*64})
    case('missing-artifact','MISSING_RESULT_ARTIFACT',missing='0000.record.json')
    case('non-prefix-history','INVALID_AUDIT_EVIDENCE',patches={'0001.started.json':None,'0001.record.json':None})
    case('orphan-record','INVALID_AUDIT_EVIDENCE',patches={'0000.started.json':None})
    case('orphan-events','INVALID_AUDIT_EVIDENCE',patches={'0006.events.jsonl':''})
    case('out-of-range-trial','INVALID_AUDIT_EVIDENCE',patches={'9999.started.json':'{}'})
    case('marker-wrong-trial','INVALID_AUDIT_EVIDENCE',patches={'0000.started.json':canonical_json(dict(trialId='other',startedAt=0))})
    case('marker-boolean-time','INVALID_AUDIT_EVIDENCE',patches={'0000.started.json':canonical_json(dict(trialId=plan['trials'][0]['id'],startedAt=True))})
    case('observation-wrong-trial','INVALID_AUDIT_EVIDENCE',patches={'0002.observation.json':canonical_json(dict(trialId='other',observation={}))})
    case('record-wrong-trial','INVALID_EVIDENCE',patches={'0000.record.json':canonical_json({**records[0],'trialId':plan['trials'][1]['id']})})
    case('started-cannot-be-skipped','INVALID_AUDIT_EVIDENCE',patches={'0000.record.json':canonical_json(skipped[0])})
    case('duplicate-record-member','INVALID_AUDIT_EVIDENCE',patches={'0000.record.json':'{"trialId":"a","trialId":"b"}'})
    case('record-bom','INVALID_AUDIT_EVIDENCE',patches={'0000.record.json':'\ufeff'+files['0000.record.json']})
    case('null-record','INVALID_AUDIT_EVIDENCE',patches={'0000.record.json':'null'})
    case('unsupported-bundle','UNSUPPORTED_AUDIT_BUNDLE',patches={'bundle.json':canonical_json({**bundle,'scope':'future'})})
    live = {**bundle,'mode':'live'}
    case('live-evidence-audited-offline',patches={'bundle.json':canonical_json(live),'operator-admission.json':'{}'},expectedStatus='reproduced')
    invalid_plan = {**plan,'executionAuthorized':True}
    case('invalid-plan','INVALID_PLAN',patches={'bundle.json':canonical_json({**bundle,'plan':invalid_plan,'planSha256':pilot_digest(invalid_plan)})})
    invalid_corpus = {**corpus,'syntheticData':False}
    case('invalid-corpus','INVALID_CORPUS',patches={'bundle.json':canonical_json({**bundle,'corpusSha256':pilot_digest(invalid_corpus)}),'corpus.json':canonical_json(invalid_corpus)})
    # A valid but differently correlated partial log cannot erase/confirm effects.
    altered = [dict(r) for r in records];altered[3] = {**records[3],'observedReads':[]}
    case('uncorrelated-log-remains-unknown',patches={'0003.events.jsonl':log({'id':'other'}),**artifacts(plan,corpus,altered)},expectedStatus='reproduced')
    suite = dict(schemaVersion=1,scope='public-result-audit-vectors-0.1',license='CC0-1.0',files=files,cases=cases)

    digest = {'type':'string','pattern':'^[a-f0-9]{64}$'}
    count = {'type':'integer','minimum':0,'maximum':4096}
    def obj(properties): return dict(type='object',properties=properties,required=list(properties),additionalProperties=False)
    props = dict(schemaVersion={'const':1},scope={'const':'result-reproduction-audit-0.1'},status={'enum':['reproduced','mismatch']},
                 **{k:digest for k in ('signedEnvelopeSha256','bundleSha256','planSha256','corpusSha256')},
                 mode={'enum':['offline','live']},runStatus={'enum':['finalized','invalid-source-changed']},recovered={'type':'boolean'},
                 **{k:{'const':True} for k in ('signatureVerified','artifactsVerified')},
                 **{k:{'const':False} for k in ('fullStudy','independentReview','executionAuthorized')},
                 trials={'type':'integer','minimum':96,'maximum':4096},
                 evidenceSources=obj({k:count for k in ('record','observation','partial','skipped')}),
                 checks={'type':'array','minItems':3,'maxItems':3,'items':obj(dict(artifact={'enum':['outcomes.json','grading.json','analysis.json']},
                             savedSha256=digest,reproducedSha256=digest,matches={'type':'boolean'}))},
                 notAudited={'const':['worker-observation-truth','usage-and-latency-summaries','source-reexecution','study-readiness']})
    schema = {'$schema':'https://json-schema.org/draft/2020-12/schema','$id':'https://psp-cdl.org/schemas/result-audit-0.1.schema.json',
              '$comment':'CC0-1.0; project draft. Reproduction does not establish observation truth or study approval.',**obj(props)}
    return {BASE/'result-audit-0.1.json':suite,ROOT/'schemas/result-audit-0.1.schema.json':schema}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__);parser.add_argument('--check',action='store_true');args = parser.parse_args()
    for path,value in generate().items():
        text = json.dumps(value,ensure_ascii=False,indent=2)+'\n'
        if args.check:
            if path.read_text(encoding='utf-8') != text: raise SystemExit('Generated audit contract differs: '+str(path))
        else: path.write_text(text,encoding='utf-8',newline='\n')
