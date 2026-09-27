# SPDX-License-Identifier: Apache-2.0
import json
import hashlib
import sys
import tempfile
import time
import unittest
from copy import deepcopy
from pathlib import Path
from unittest.mock import patch, Mock
from psp_cdl_test_harness import (create_pilot_plan, validate_heldout_corpus, grade_pilot_evidence,
                                 grade_pilot_records, analyze_pilot, pilot_digest, PilotError)

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0,str(ROOT/'scripts'))
import heldout
BASE = ROOT/'conformance/vectors/evaluation'
def load(name): return json.loads((BASE/(name+'-0.1.json')).read_text(encoding='utf-8'))
CORPUS, REQUEST, REHEARSAL, SUITE = (load('heldout-'+v) for v in ('corpus','request','rehearsal','grading'))
SOURCE = {'commit':'0'*40,'modified':False,'sha256':'0'*64,'files':[],'runtime':{'node':'v24.0.0','python':'3.12.0','platform':'test'}}


class HeldoutTests(unittest.TestCase):
    def test_shared_grading_vectors(self):
        cases = {c['id']:c for c in CORPUS['cases']}
        for item in SUITE['cases']:
            with self.subTest(case=item['id']):
                if 'code' in item['expected']:
                    with self.assertRaises(PilotError) as error: grade_pilot_evidence(cases[item['caseId']],item['record'])
                    self.assertEqual(error.exception.code,item['expected']['code'])
                else:
                    result = grade_pilot_evidence(cases[item['caseId']],item['record'])
                    self.assertEqual({k:result['row'][k] for k in item['expected']},item['expected'])
                    self.assertFalse(result['details']['independentReview'])
                    self.assertNotIn(cases[item['caseId']]['input']['privateText'],json.dumps(result))

    def test_corpus_identity_pairing_and_authority_fields_rejected(self):
        plan = create_pilot_plan(REQUEST)
        normalized = validate_heldout_corpus(plan,CORPUS)
        reverse = deepcopy(CORPUS);reverse['cases'].reverse()
        self.assertEqual(validate_heldout_corpus(plan,reverse),normalized)
        for mutation in ('missing','duplicate','pair','records','rubric','authority','public-relabel'):
            value = deepcopy(CORPUS)
            if mutation == 'missing': value['cases'].pop()
            if mutation == 'duplicate': value['cases'][-1] = value['cases'][0]
            if mutation == 'pair': value['cases'][0]['pairId'] = 'other'
            if mutation == 'records': value['cases'][0]['input']['privateText'] += '-changed'
            if mutation == 'rubric': value['cases'][0]['rubric']['forbiddenReads'] = ['public']
            if mutation == 'authority': value['cases'][0]['input']['approved'] = True
            if mutation == 'public-relabel': value['provenance'] = 'held-out'
            with self.subTest(mutation=mutation),self.assertRaises(PilotError): validate_heldout_corpus(plan,value)

    def test_full_evidence_projection_preserves_every_denominator(self):
        plan = create_pilot_plan(REQUEST)
        rows = [{'trialId':t['id'],'completion':'skipped','observation':None,'observedReads':[]} for t in plan['trials']]
        result = grade_pilot_records(plan,CORPUS,rows)
        analysis = analyze_pilot(plan,result['outcomes'])
        self.assertEqual(sum(g['statuses']['skipped'] for g in analysis['groups']),96)
        for bad in (rows[:-1],list(reversed(rows)),[rows[0]]*96):
            with self.assertRaises(PilotError): grade_pilot_records(plan,CORPUS,bad)

    def workspace(self, request=REQUEST):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        directory = Path(temp.name).resolve()
        (directory/'evaluation').mkdir()
        root_patch = patch.object(heldout,'ROOT',directory);root_patch.start();self.addCleanup(root_patch.stop)
        source_patch = patch.object(heldout,'execution_source',return_value=deepcopy(SOURCE));source_patch.start();self.addCleanup(source_patch.stop)
        bundle = heldout.make_bundle(create_pilot_plan(request),CORPUS,'offline','node',REHEARSAL)
        return bundle

    def test_sequential_order_single_use_and_cancellation(self):
        bundle = self.workspace();calls=[]
        def execute(t,c,b,n,d,i,steps,stopped,key):
            self.assertEqual(key,'');self.assertEqual(i,len(calls));calls.append(t['id'])
            return {'trialId':t['id'],'completion':'error','observation':None,'observedReads':[]}
        result = heldout.run(bundle,CORPUS,'node',REHEARSAL,execute_trial=execute,stopped=lambda:len(calls)>=2)
        self.assertEqual(calls,[t['id'] for t in bundle['plan']['trials'][:2]])
        self.assertEqual(sum(g['statuses']['skipped'] for g in result['groups']),94)
        self.assertEqual(sum(g['statuses']['error'] for g in result['groups']),2)
        self.assertEqual(result['usage']['unobservedTrials'],2)
        with self.assertRaises(FileExistsError): heldout.run(bundle,CORPUS,'node',REHEARSAL,execute_trial=execute)

    def test_pins_and_rehearsal_changes_fail_before_worker_or_credentials(self):
        bundle = self.workspace();calls=[]
        for field in ('corpusSha256','model','planSha256','decoding','executionAuthorized'):
            bad = deepcopy(bundle);bad[field] = 'forged'
            with self.subTest(field=field),self.assertRaises((ValueError,TypeError)):
                heldout.run(bad,CORPUS,'node',REHEARSAL,execute_trial=lambda *a:calls.append(a))
        changed = deepcopy(REHEARSAL);changed['cases'][0]['steps'] = [{'final':'different'}]
        with self.assertRaises(ValueError): heldout.run(bundle,CORPUS,'node',changed,execute_trial=lambda *a:calls.append(a))
        self.assertEqual(calls,[])

    def test_source_change_stops_before_next_trial_and_marks_result_invalid(self):
        bundle = self.workspace();calls=[]
        def execute(t,*_):
            calls.append(t['id'])
            return {'trialId':t['id'],'completion':'error','observation':None,'observedReads':[]}
        with patch.object(heldout,'source_files_unchanged',side_effect=[True,False,False]):
            result = heldout.run(bundle,CORPUS,'node',REHEARSAL,execute_trial=execute)
        self.assertEqual(len(calls),1);self.assertEqual(result['status'],'invalid-source-changed')

    def test_recovery_preserves_partial_effect_and_refuses_active_lock(self):
        request = deepcopy(REQUEST)
        while True:
            first = create_pilot_plan(request)['trials'][0]
            if first['kind']=='attack' and first['family']=='direct-read': break
            request['orderSeed'] += 1
        bundle = self.workspace(request);directory = heldout.run_directory(bundle);directory.mkdir(parents=True)
        heldout.write(directory/'bundle.json',bundle,True)
        t = bundle['plan']['trials'][0]
        heldout.write(directory/'0000.started.json',{'trialId':t['id'],'startedAt':time.time()},True)
        with heldout.locked(directory):
            with self.assertRaises(OSError):
                with heldout.locked(directory): pass
        with self.assertRaises(ValueError): heldout.finalize(bundle,CORPUS,directory,'node',True)
        heldout.write(directory/'0000.started.json',{'trialId':t['id'],'startedAt':time.time()-181})
        events = [{'sequence':1,'correlation':t['id'],'kind':'isolation-probes-blocked','recordId':None,'code':None},
                  {'sequence':2,'correlation':t['id'],'kind':'read','recordId':'private','code':None}]
        (directory/'0000.events.jsonl').write_text(''.join(json.dumps(e)+'\n' for e in events),encoding='utf-8')
        result = heldout.finalize(bundle,CORPUS,directory,'node',True)
        self.assertTrue(result['recovered'])
        rows = heldout.read(directory/'outcomes.json')['rows'];self.assertEqual(rows[0]['status'],'error')
        self.assertEqual(sum(r['status']=='skipped' for r in rows),95)
        self.assertTrue(rows[0]['attackSuccess'])
        self.assertEqual(sum(g['latencyMs']['unobservedTrials'] for g in result['groups']),1)
        with self.assertRaises(ValueError): heldout.finalize(bundle,CORPUS,directory,'node',True)

    def test_live_operator_admission_is_explicit_and_bundle_bound(self):
        bundle = self.workspace();bundle['mode']='live'
        with self.assertRaises(ValueError): heldout.admit(bundle,None,False)
        approval = {'schemaVersion':1,'bundleSha256':pilot_digest(bundle),'approved':True,'operator':'synthetic-test','evidencePolicy':heldout.EVIDENCE_POLICY}
        heldout.admit(bundle,approval,True)
        changed = deepcopy(bundle);changed['corpusSha256']='1'*64
        with self.assertRaises(ValueError): heldout.admit(changed,approval,True)
        with self.assertRaises(ValueError): heldout.admit(bundle,approval,False)
        with self.assertRaises(ValueError): heldout.admit({**bundle,'mode':'offline'},approval,True)

    def test_live_preparation_cannot_promote_public_fixture(self):
        self.workspace()
        with self.assertRaises(ValueError): heldout.make_bundle(create_pilot_plan(REQUEST),CORPUS,'live','node',None,{'ceiling':'1'},{'corpusProvenance':'no-file'})

    def test_worker_payload_excludes_rubrics_and_filters_environment(self):
        bundle = self.workspace();directory = heldout.run_directory(bundle);directory.mkdir(parents=True)
        trial=bundle['plan']['trials'][0];case=next(c for c in CORPUS['cases'] if c['id']==trial['caseId'])
        process=Mock();process.poll.return_value=0;process.communicate.return_value=(None,None)
        with patch.object(heldout.subprocess,'Popen',return_value=process) as launch,patch.dict(heldout.os.environ,{'PSP_OPENAI_API_KEY':'synthetic-env-secret','UNRELATED_SECRET':'synthetic-other'}):
            heldout.execute(trial,case,bundle,'node',directory,0,[{'final':'test'}],lambda:False,'')
        payload=json.loads(process.communicate.call_args.args[0])
        self.assertEqual(set(payload),{'input','config'});self.assertEqual(payload['input'],case['input'])
        self.assertNotIn('rubric',json.dumps(payload));self.assertNotIn('reviews',payload['config'])
        self.assertNotIn('PSP_OPENAI_API_KEY',launch.call_args.kwargs['env'])
        self.assertNotIn('UNRELATED_SECRET',launch.call_args.kwargs['env'])

    def test_live_bundle_reviews_budget_and_rejection_precede_credential_lookup(self):
        self.workspace()
        request=json.loads((BASE/'pilot-request-0.1.json').read_text())
        request['manifest']['provenance']='unreviewed-input'
        plan=create_pilot_plan(request)
        corpus={**CORPUS,'provenance':'unreviewed-input','cases':[]}
        for pair in request['manifest']['pairs']:
            for kind in ('attack','benign'):
                case=deepcopy(next(c for c in CORPUS['cases'] if c['family']==pair['family'] and c['kind']==kind))
                case.update(id=pair[kind+'CaseId'],pairId=pair['id']);corpus['cases'].append(case)
        corpus=validate_heldout_corpus(plan,corpus)
        (heldout.ROOT/'evaluation/PREREGISTRATION.md').write_text('Synthetic test protocol')
        common={'schemaVersion':1,'corpusSha256':pilot_digest(corpus),'approved':True}
        statements={
            'corpusProvenance':{**common,'heldOut':True,'syntheticData':True,'custodian':'synthetic-test','relationship':'test-only','priorExposure':'public test data'},
            'rubricReview':{**common,'method':heldout.METHOD,'reviewer':'synthetic-test','relationship':'test-only'},
            'preregistration':{**common,'planSha256':pilot_digest(plan),'protocolSha256':hashlib.sha256(b'Synthetic test protocol').hexdigest(),'decision':'approved-for-collection','maintainer':'synthetic-test'},
        }
        paths={}
        for name,value in statements.items():
            paths[name]=heldout.ROOT/(name+'.json');paths[name].write_text(json.dumps(value))
        live={'ceiling':'4000','inputRate':'0.4','outputRate':'1.6','capabilities':{'complete':True,'sources':[{'id':'synthetic-test','capabilities':[]}]}}
        with patch.object(heldout.development,'validate'):
            bundle=heldout.make_bundle(plan,corpus,'live','node',None,live,paths)
            self.assertEqual(bundle['budget']['planReservedMicroUsd'],1920*1676944)
            self.assertEqual(heldout.check_bundle(bundle,corpus,'node'),corpus)
            environment=Mock()
            with patch.object(heldout.os,'environ',environment),self.assertRaises(ValueError): heldout.run(bundle,corpus,'node')
            environment.get.assert_not_called()
            with self.assertRaises(ValueError): heldout.make_bundle(plan,corpus,'live','node',None,{**live,'ceiling':'1'},paths)
            statements['rubricReview']['reviewer']='changed-test-reviewer'
            paths['rubricReview'].write_text(json.dumps(statements['rubricReview']))
            with self.assertRaises(ValueError): heldout.check_bundle(bundle,corpus,'node')

    def test_late_coordinator_cancellation_cannot_erase_completed_disclosure(self):
        bundle=self.workspace();directory=heldout.run_directory(bundle);directory.mkdir(parents=True)
        trial=next(t for t in bundle['plan']['trials'] if t['kind']=='attack' and t['family']=='direct-read' and t['condition']=='unprotected')
        case=next(c for c in CORPUS['cases'] if c['id']==trial['caseId'])
        observation=deepcopy(SUITE['cases'][0]['record']['observation'])
        heldout.write(directory/'0000.observation.json',{'trialId':trial['id'],'observation':observation},True)
        process=Mock();process.poll.return_value=0;process.communicate.return_value=(None,None)
        with patch.object(heldout.subprocess,'Popen',return_value=process):
            record=heldout.execute(trial,case,bundle,'node',directory,0,[{'final':'test'}],lambda:True,'')
        result=grade_pilot_evidence(case,record)
        self.assertTrue(result['details']['disclosure']);self.assertTrue(result['row']['attackSuccess'])
        self.assertEqual(result['row']['status'],'observed')


if __name__ == '__main__': unittest.main()
