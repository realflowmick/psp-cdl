# SPDX-License-Identifier: Apache-2.0
"""Pinned Topology B execution and recoverable, local synthetic evidence."""
import contextlib
import hashlib
import importlib.util
import json
import math
import os
import signal
import subprocess
import sys
import time
import uuid
from pathlib import Path

from psp_cdl_core import canonical_json, parse_json
from psp_cdl_test_harness import (validate_pilot_plan, validate_heldout_corpus, validate_pilot_steps,
    validate_pilot_observation, grade_pilot_records, analyze_pilot, pilot_digest)
from study import budget, aggregate, usage_summary
from topology_common import read_events

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('development_runner',ROOT/'scripts/run-study.py')
development = importlib.util.module_from_spec(spec)
spec.loader.exec_module(development)
EVIDENCE_POLICY = 'local-synthetic-raw-0.1'
METHOD = 'observable-exact-0.1'
MODEL = 'gpt-4.1-mini-2025-04-14'
REVISION = 'chat-v1-gpt-4.1-mini-2025-04-14-psp-0.1'
DECODING = {'stream':False,'maxOutputTokens':128,'maxSteps':4,'temperature':'provider-default','seed':None,'workers':1}


def execution_source(node):
    source = development.provenance(node)
    source['modified'] = source['modified'] or bool(development.git('status','--porcelain','--untracked-files=all','--','evaluation'))
    return source


def read(path, limit=4194304):
    with Path(path).open('rb') as source: data = source.read(limit+1)
    if len(data) > limit: raise ValueError('Input too large')
    return parse_json(data.decode('utf-8'))


def exact(value, keys):
    if type(value) is not dict or set(value) != set(keys): raise ValueError('Invalid fields')


def artifact(path):
    base = ROOT/'.artifacts'
    target = Path(path).resolve()
    if base.resolve() != base or not target.is_relative_to(base) or target.suffix != '.json':
        raise ValueError('Output outside artifact directory')
    return target


def write(path, value, exclusive=False):
    path = artifact(path)
    path.parent.mkdir(parents=True,exist_ok=True)
    data = (canonical_json(value)+'\n').encode('utf-8')
    if exclusive:
        with path.open('xb') as target:
            target.write(data);target.flush();os.fsync(target.fileno())
    else:
        temporary = path.with_name(path.name+'.'+uuid.uuid4().hex+'.tmp')
        with temporary.open('xb') as target:
            target.write(data);target.flush();os.fsync(target.fileno())
        temporary.replace(path)


def rehearsal(value, corpus):
    exact(value,('schemaVersion','cases'))
    if type(value['schemaVersion']) is not int or value['schemaVersion'] != 1 or type(value['cases']) is not list: raise ValueError('Invalid rehearsal')
    steps = {}
    for c in value['cases']:
        exact(c,('caseId','steps'))
        if type(c['caseId']) is not str or c['caseId'] in steps: raise ValueError('Invalid rehearsal case')
        steps[c['caseId']] = validate_pilot_steps(c['steps'])
    if set(steps) != {c['id'] for c in corpus['cases']}: raise ValueError('Incomplete rehearsal')
    return steps


def reviews(paths, plan, corpus):
    """Check host-supplied statements and hashes; do not authenticate reviewer identities."""
    result = {}
    fields = {
        'corpusProvenance':('custodian','relationship','priorExposure'),
        'rubricReview':('reviewer','relationship'),
        'preregistration':('maintainer',),
    }
    for name, labels in fields.items():
        path = Path(paths[name]).resolve()
        value = read(path,65536)
        extras = {'heldOut','syntheticData'} if name == 'corpusProvenance' else {'method'} if name == 'rubricReview' else {'planSha256','protocolSha256','decision'}
        exact(value,{'schemaVersion','corpusSha256','approved',*labels,*extras})
        if type(value['schemaVersion']) is not int or value['schemaVersion'] != 1 or value['approved'] is not True or value['corpusSha256'] != pilot_digest(corpus): raise ValueError('Review binding mismatch')
        if any(type(value[k]) is not str or not 1 <= len(value[k].encode('utf-8')) <= 4096 for k in labels): raise ValueError('Missing reviewer disclosure')
        if name == 'corpusProvenance' and (value['heldOut'] is not True or value['syntheticData'] is not True): raise ValueError('Invalid corpus provenance')
        if name == 'rubricReview' and value['method'] != METHOD: raise ValueError('Unsupported grading review')
        if name == 'preregistration' and (value['planSha256'] != pilot_digest(plan) or value['protocolSha256'] != hashlib.sha256((ROOT/'evaluation/PREREGISTRATION.md').read_bytes()).hexdigest() or value['decision'] != 'approved-for-collection'):
            raise ValueError('Preregistration mismatch')
        result[name] = {'path':str(path),'sha256':pilot_digest(value),'statement':value}
    return result


def make_bundle(plan_value, corpus_value, mode, node, rehearsal_value=None, live=None, review_paths=None):
    plan = validate_pilot_plan(plan_value)
    corpus = validate_heldout_corpus(plan,corpus_value)
    source = execution_source(node)
    # Include the full evaluation protocol/tools, which the development runner's
    # older source inventory does not cover, as an additional immutable pin.
    protocol_files = [{'path':p.relative_to(ROOT).as_posix(),'sha256':hashlib.sha256(p.read_bytes()).hexdigest()}
                      for p in sorted((ROOT/'evaluation').rglob('*')) if p.is_file()]
    accounting, attestations = None, None
    sources = [{'id':'synthetic-offline-provider','capabilities':[]}]
    if mode == 'offline':
        if live is not None or review_paths is not None or rehearsal_value is None: raise ValueError('Invalid offline admission')
        rehearsal(rehearsal_value,corpus)
    elif mode == 'live':
        if rehearsal_value is not None or not live or not review_paths or source['modified']: raise ValueError('Live preparation requires clean sources, reviews and budget')
        if corpus['provenance'] != 'unreviewed-input': raise ValueError('Public fixtures cannot become held-out inputs')
        expected = {'pairsPerFamily':4,'repetitions':5,'orderSeed':492026,'analysisSeed':492027,'bootstrapResamples':10000}
        if any(plan['request'][k] != v for k,v in expected.items()): raise ValueError('Allocation requires a versioned amendment')
        accounting = budget(len(plan['trials']),live['ceiling'],live['inputRate'],live['outputRate'])
        development.validate(node,'capabilities',live['capabilities'])
        sources = live['capabilities']['sources']
        attestations = reviews(review_paths,plan,corpus)
    else: raise ValueError('Unsupported mode')
    return {'schemaVersion':1,'scope':'heldout-execution-0.1','runId':uuid.uuid4().hex,'mode':mode,
            'plan':plan,'planSha256':pilot_digest(plan),'corpusSha256':pilot_digest(corpus),
            'rehearsalSha256':pilot_digest(rehearsal_value) if rehearsal_value is not None else None,
            'source':source,'protocolFiles':protocol_files,'model':MODEL,'providerRevision':REVISION,
            'providerSources':sources,'decoding':DECODING.copy(),'budget':accounting,'reviews':attestations,
            'gradingMethod':METHOD,'evidencePolicy':EVIDENCE_POLICY,'executionAuthorized':False,'fullStudy':False}


def check_bundle(bundle, corpus, node, rehearsal_value=None):
    exact(bundle,('schemaVersion','scope','runId','mode','plan','planSha256','corpusSha256','rehearsalSha256','source','protocolFiles',
                  'model','providerRevision','providerSources','decoding','budget','reviews','gradingMethod','evidencePolicy','executionAuthorized','fullStudy'))
    import re
    if type(bundle['runId']) is not str or re.fullmatch('[a-f0-9]{32}',bundle['runId']) is None: raise ValueError('Invalid run identity')
    if bundle['mode'] == 'live':
        b = bundle['budget']
        if type(b) is not dict: raise ValueError('Missing budget')
        def usd(key): return f"{b[key]//1000000}.{b[key]%1000000:06d}" if type(b[key]) is int else 'invalid'
        live = {'ceiling':usd('ceilingMicroUsd'),'inputRate':usd('inputRateMicroUsdPerMillion'),'outputRate':usd('outputRateMicroUsdPerMillion'),
                'capabilities':{'complete':True,'sources':bundle['providerSources']}}
        if type(bundle['reviews']) is not dict: raise ValueError('Missing reviews')
        paths = {k:v['path'] for k,v in bundle['reviews'].items()}
    else: live,paths = None,None
    expected = make_bundle(bundle['plan'],corpus,bundle['mode'],node,rehearsal_value,live,paths)
    expected['runId'] = bundle['runId']
    if canonical_json(expected) != canonical_json(bundle): raise ValueError('Frozen bundle or source changed')
    return validate_heldout_corpus(bundle['plan'],corpus)


def admit(bundle, approval, allow_live):
    """This precedes credential lookup and every worker launch."""
    if bundle['mode'] == 'offline':
        if approval is not None or allow_live: raise ValueError('Live flags in offline mode')
        return
    if not allow_live or approval is None: raise ValueError('Live run requires explicit operator admission')
    exact(approval,('schemaVersion','bundleSha256','operator','approved','evidencePolicy'))
    if type(approval['schemaVersion']) is not int or approval['schemaVersion'] != 1 or approval['approved'] is not True or approval['bundleSha256'] != pilot_digest(bundle) or approval['evidencePolicy'] != EVIDENCE_POLICY or type(approval['operator']) is not str or not 1 <= len(approval['operator']) <= 256:
        raise ValueError('Operator admission does not bind this bundle')


def run_directory(bundle):
    return artifact(ROOT/'.artifacts/heldout-runs'/pilot_digest(bundle)/'manifest.json').parent


def source_files_unchanged(bundle):
    try:
        return all(hashlib.sha256((ROOT/f['path']).read_bytes()).hexdigest() == f['sha256'] for f in [*bundle['source']['files'],*bundle['protocolFiles']])
    except OSError: return False


@contextlib.contextmanager
def locked(directory):
    # OS locks release on process exit. Finalization cannot overlap the runner.
    with (directory/'active.lock').open('a+b') as handle:
        handle.seek(0);handle.write(b'0');handle.flush();handle.seek(0)
        if os.name == 'nt':
            import msvcrt
            msvcrt.locking(handle.fileno(),msvcrt.LK_NBLCK,1)
        else:
            import fcntl
            fcntl.flock(handle.fileno(),fcntl.LOCK_EX|fcntl.LOCK_NB)
        try: yield
        finally:
            if os.name == 'nt':
                handle.seek(0);msvcrt.locking(handle.fileno(),msvcrt.LK_UNLCK,1)
            else: fcntl.flock(handle.fileno(),fcntl.LOCK_UN)


def partial_reads(path, trial_id):
    try:
        events = read_events(path,trial_id,False)
        if not events or events[0] != {'kind':'isolation-probes-blocked','recordId':None,'code':None} or len(events) > 4: return []
        if any(e != {'kind':'read','recordId':e['recordId'],'code':None} or e['recordId'] not in ('public','private') for e in events[1:]): return []
        return [e['recordId'] for e in events[1:]]
    except (OSError,ValueError,RuntimeError,KeyError,TypeError): return []


def stop_worker(process):
    if process.poll() is not None: return
    if os.name == 'nt':
        subprocess.run(['taskkill','/PID',str(process.pid),'/T','/F'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,timeout=10)
    else: os.killpg(process.pid,signal.SIGKILL)
    process.wait(timeout=10)


def execute(trial, case, bundle, node, directory, index, steps, stopped, credential):
    runtime = {'typescript':node,'python':sys.executable}
    peer = ROOT/('scripts/study-server.mjs' if trial['peer'] == 'typescript' else 'scripts/study_server.py')
    worker = ROOT/('scripts/heldout-worker.mjs' if trial['host'] == 'typescript' else 'scripts/heldout-worker.py')
    stem = f'{index:04d}'
    config = {'mode':bundle['mode'],'allowLive':bundle['mode']=='live','reservedMicroUsd':bundle['budget']['perTrialMicroUsd'] if bundle['budget'] else 0,
              'sources':bundle['providerSources'],'caseId':trial['caseId'],'trialId':trial['id'],'condition':trial['condition'],
              'peerExecutable':runtime[trial['peer']],'peerScript':str(peer),'cancelFile':str(directory/(stem+'.cancel')),
              'eventFile':str(directory/(stem+'.events.jsonl')),'observationFile':str(directory/(stem+'.observation.json'))}
    if steps is not None: config['offlineSteps'] = steps
    # Rubrics and reviews are never included in the worker's stdin or environment.
    payload = canonical_json({'config':config,'input':case['input']}).encode('utf-8')
    env = {k:os.environ[k] for k in ('SystemRoot','TEMP','TMP') if k in os.environ}
    env.update(PYTHONIOENCODING='utf-8',PYTHONDONTWRITEBYTECODE='1')
    if bundle['mode'] == 'live': env['PSP_OPENAI_API_KEY'] = credential
    # Output is written by the worker to a bounded observation file. Suppress
    # stdout/stderr so untrusted output cannot grow an in-memory pipe buffer.
    process = subprocess.Popen([runtime[trial['host']],str(worker)],cwd=ROOT,stdin=subprocess.PIPE,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,
        env=env,creationflags=subprocess.CREATE_NEW_PROCESS_GROUP if os.name == 'nt' else 0,start_new_session=os.name!='nt')
    started, sent, cancelled_at = time.monotonic(),False,None
    try:
        while True:
            if stopped() or time.monotonic()-started > 75:
                Path(config['cancelFile']).touch(exist_ok=True)
                if cancelled_at is None: cancelled_at = time.monotonic()
            if cancelled_at is not None and time.monotonic()-cancelled_at > 5:
                stop_worker(process);break
            try:
                process.communicate(payload if not sent else None,timeout=.2)
                break
            except subprocess.TimeoutExpired: sent = True
    finally: stop_worker(process)
    record = {'trialId':trial['id'],'completion':'cancelled' if stopped() else 'error','observation':None,
              'observedReads':partial_reads(Path(config['eventFile']),trial['id'])}
    path = Path(config['observationFile'])
    if path.exists():
        value = read(path,131072)
        exact(value,('trialId','observation'))
        if value['trialId'] != trial['id']: raise ValueError('Observation identity mismatch')
        o = validate_pilot_observation(value['observation'])
        # A validated observation already persisted by the worker is evidence of
        # its completed release decision. A later coordinator cancellation must
        # not erase a disclosure that already occurred. Worker-side cancellation
        # before release produces CANCELLED with no output through the loop gate.
        record.update(completion='returned',observation=o,observedReads=[])
    return record


def finalize(bundle, corpus_value, directory, node, recovering=False):
    corpus = validate_heldout_corpus(bundle['plan'],corpus_value)
    if pilot_digest(corpus) != bundle['corpusSha256'] or read(directory/'bundle.json') != bundle: raise ValueError('Recovery binding mismatch')
    if (directory/'manifest.json').exists(): raise ValueError('Run already finalized')
    rows, files, timings, started_indices, unstarted = [],[],{},set(),False
    for i,t in enumerate(bundle['plan']['trials']):
        stem = f'{i:04d}';path = directory/(stem+'.record.json');start = directory/(stem+'.started.json')
        if not start.exists():
            unstarted = True
            if path.exists() or (directory/(stem+'.observation.json')).exists() or (directory/(stem+'.timing.json')).exists(): raise ValueError('Evidence for unstarted trial')
            r = {'trialId':t['id'],'completion':'skipped','observation':None,'observedReads':[]}
        else:
            if unstarted: raise ValueError('Non-prefix execution history')
            started_indices.add(i)
            marker = read(start)
            exact(marker,('trialId','startedAt'))
            if marker['trialId'] != t['id'] or type(marker['startedAt']) not in (int,float): raise ValueError('Invalid trial marker')
            if recovering and not path.exists() and time.time()-marker['startedAt'] < 180: raise ValueError('Wait for the bounded worker/peer lifetime before recovery')
            if path.exists(): r = read(path,131072)
            elif (directory/(stem+'.observation.json')).exists():
                observed = read(directory/(stem+'.observation.json'),131072)
                exact(observed,('trialId','observation'))
                if observed['trialId'] != t['id']: raise ValueError('Observation identity mismatch')
                r = {'trialId':t['id'],'completion':'returned','observation':observed['observation'],'observedReads':[]}
            else: r = {'trialId':t['id'],'completion':'error','observation':None,'observedReads':partial_reads(directory/(stem+'.events.jsonl'),t['id'])}
            timing_path = directory/(stem+'.timing.json')
            if timing_path.exists():
                timing = read(timing_path)
                exact(timing,('trialId','elapsedMs'))
                if timing['trialId'] != t['id'] or type(timing['elapsedMs']) is not int or not 0 <= timing['elapsedMs'] <= 86400000: raise ValueError('Invalid trial timing')
                timings[i] = timing['elapsedMs']
        rows.append(r)
    graded = grade_pilot_records(bundle['plan'],corpus,rows)
    analysis = analyze_pilot(bundle['plan'],graded['outcomes'])
    summary_rows = [{**t,'kind':t['kind'],'status':g['status'],**({'observation':r['observation']} if r['observation'] else {}),'outcome':g}
                    for t,g,r in zip(bundle['plan']['trials'],graded['outcomes']['rows'],rows)]
    current_source = execution_source(node)
    source_unchanged = current_source == bundle['source'] and source_files_unchanged(bundle)
    groups = aggregate(summary_rows)
    for group in groups:
        indices = [i for i,t in enumerate(bundle['plan']['trials']) if (t['condition'],t['host'],t['peer']) == (group['condition'],group['host'],group['peer'])]
        durations = sorted(timings[i] for i in indices if i in timings)
        group['latencyMs'] = {'samples':len(durations),'p50':durations[math.ceil(.5*len(durations))-1] if durations else None,
                             'p95':durations[math.ceil(.95*len(durations))-1] if durations else None,
                             'unobservedTrials':sum(i in started_indices and i not in timings for i in indices)}
    artifacts = {'outcomes.json':graded['outcomes'],'grading.json':graded['grading'],'analysis.json':analysis}
    # Artifact files may exist after a crash during finalization; require their
    # bytes to match the newly derived content, then complete the manifest once.
    for name,value in artifacts.items():
        path = directory/name
        if path.exists():
            if read(path) != value: raise ValueError('Existing finalization artifact differs')
        else: write(path,value,True)
    for p in sorted(directory.iterdir()):
        if p.suffix in ('.json','.jsonl') and p.name != 'manifest.json': files.append({'path':p.name,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()})
    manifest = {'schemaVersion':1,'scope':'heldout-execution-result-0.1','bundleSha256':pilot_digest(bundle),'planSha256':bundle['planSha256'],
        'corpusSha256':bundle['corpusSha256'],'mode':bundle['mode'],'status':'finalized' if source_unchanged else 'invalid-source-changed',
        'recovered':recovering,'fullStudy':False,'independentReview':False,'signed':False,'files':files,
        'latencyBasis':'Coordinator trial start through validated evidence persistence, including worker startup and cleanup; missing crash timings remain unknown.',
        'groups':groups,'usage':usage_summary({**bundle,'trials':bundle['plan']['trials']},summary_rows),
        'limitations':['Automated exact-match/canary grading is not independent review or a complete disclosure detector.',
                       'Host review statements and local hashes are not authenticated reviewer identities or a signed result manifest.',
                       'All planned rows are retained; missing observations remain unknown and unstarted trials remain skipped.']}
    write(directory/'manifest.json',manifest,True)
    return manifest


def run(bundle, corpus_value, node, rehearsal_value=None, approval=None, allow_live=False, execute_trial=execute, stopped=None):
    corpus = check_bundle(bundle,corpus_value,node,rehearsal_value)
    admit(bundle,approval,allow_live)
    credential = ''
    if bundle['mode'] == 'live':
        credential = os.environ.get('PSP_OPENAI_API_KEY','')
        if not credential or not credential.isascii() or any(c.isspace() for c in credential): raise ValueError('Missing host credential')
    directory = run_directory(bundle)
    directory.mkdir(parents=True,exist_ok=False) # One attempt per bundle, even if copied to a new filename.
    cancelled = False
    def stop(*_):
        nonlocal cancelled
        cancelled = True
    stop_requested = lambda: cancelled or (stopped() if stopped else False)
    previous = signal.signal(signal.SIGINT,stop)
    try:
        with locked(directory):
            write(directory/'bundle.json',bundle,True)
            write(directory/'corpus.json',corpus,True)
            if approval is not None: write(directory/'operator-admission.json',approval,True)
            cases = {c['id']:c for c in corpus['cases']}
            steps = rehearsal(rehearsal_value,corpus) if rehearsal_value is not None else {}
            for i,t in enumerate(bundle['plan']['trials']):
                if stop_requested() or not source_files_unchanged(bundle): break
                stem = f'{i:04d}'
                started = time.monotonic()
                write(directory/(stem+'.started.json'),{'trialId':t['id'],'startedAt':time.time()},True)
                try: r = execute_trial(t,cases[t['caseId']],bundle,node,directory,i,steps.get(t['caseId']),stop_requested,credential)
                except (OSError,ValueError,subprocess.SubprocessError):
                    r = {'trialId':t['id'],'completion':'cancelled' if stop_requested() else 'error','observation':None,'observedReads':partial_reads(directory/(stem+'.events.jsonl'),t['id'])}
                # Validate this result before persisting it as completed evidence.
                from psp_cdl_test_harness import grade_pilot_evidence
                try: grade_pilot_evidence(cases[t['caseId']],r)
                except ValueError:
                    r = {'trialId':t['id'],'completion':'error','observation':None,'observedReads':partial_reads(directory/(stem+'.events.jsonl'),t['id'])}
                write(directory/(stem+'.record.json'),r,True)
                write(directory/(stem+'.timing.json'),{'trialId':t['id'],'elapsedMs':int((time.monotonic()-started)*1000+0.5)},True)
            return finalize(bundle,corpus,directory,node)
    finally: signal.signal(signal.SIGINT,previous)
