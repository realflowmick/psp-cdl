# SPDX-License-Identifier: Apache-2.0
"""Run a synthetic development study. No live calls without explicit admission."""
import argparse
import json
import os
import platform
import shutil
import signal
import subprocess
import sys
import tempfile
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from study import (LANGUAGES, CONDITIONS, INPUT_RESERVATION, OUTPUT_LIMIT, MAX_CALLS, aggregate, budget, digest, encoded,
                   exit_code, grade, trials, validate_corpus, validate_results)

ROOT = Path(__file__).resolve().parents[1]
CORPUS = 'conformance/vectors/evaluation/study-0.1.json'


def git(*args): return subprocess.check_output(['git',*args],cwd=ROOT).decode('utf-8').strip()


def provenance(node):
    paths = ['implementations','scripts','conformance','schemas','specs/profiles','specs/psp','specs/cdl','evaluation/PROTOCOL.md',
             'evaluation/STUDY-RUNNER.md','project.json','package.json','package-lock.json','pyproject.toml','uv.lock']
    sources = sorted(set(git('ls-files','--cached','--others','--exclude-standard','--',*paths).splitlines()))
    built = sorted(p.relative_to(ROOT).as_posix() for p in (ROOT/'implementations/typescript/packages').glob('*/dist/**/*.js'))
    if not built: raise ValueError('Build TypeScript before running the study.')
    files = [{'path':p,'sha256':digest((ROOT/p).read_bytes())} for p in sorted(set(sources+built)) if (ROOT/p).is_file()]
    return {'commit':git('rev-parse','HEAD'),'modified':bool(git('status','--porcelain','--untracked-files=all','--',*paths)),
            'sha256':digest(encoded(files)),'files':files,'runtime':{'node':subprocess.check_output([node,'--version'],text=True).strip(),
            'python':platform.python_version(),'platform':sys.platform}}


def validate(node, kind, value):
    process = subprocess.run([node,'scripts/validate-study.mjs',kind],cwd=ROOT,input=json.dumps(value),capture_output=True,text=True,encoding='utf-8',timeout=15)
    if process.returncode: raise ValueError('Invalid study '+kind)


def save(path, value):
    path.parent.mkdir(parents=True,exist_ok=True)
    temporary = path.with_suffix(path.suffix+'.tmp')
    temporary.write_bytes(encoded(value)+b'\n')
    temporary.replace(path)


def execute(trial, config, node, cancel_file, stopped, credential):
    runtimes = {'typescript':node,'python':sys.executable}
    adapter = 'scripts/study-adapter.mjs' if trial['host'] == 'typescript' else 'scripts/study_adapter.py'
    peer = 'scripts/study-server.mjs' if trial['peer'] == 'typescript' else 'scripts/study_server.py'
    payload = {**config,'caseId':trial['caseId'],'condition':trial['condition'],'peerExecutable':runtimes[trial['peer']],
               'peerScript':str(ROOT/peer),'cancelFile':str(cancel_file)}
    env = {k:os.environ[k] for k in ('SystemRoot','TEMP','TMP') if k in os.environ}
    env.update(PYTHONIOENCODING='utf-8',PYTHONDONTWRITEBYTECODE='1')
    if config['mode'] == 'live': env['PSP_OPENAI_API_KEY'] = credential
    process = subprocess.Popen([runtimes[trial['host']],adapter],cwd=ROOT,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,
        text=True,encoding='utf-8',env=env,creationflags=subprocess.CREATE_NEW_PROCESS_GROUP if os.name == 'nt' else 0)
    start, sent, cancel_at = time.monotonic(), False, None
    try:
        while True:
            if stopped() or time.monotonic()-start > 75:
                cancel_file.touch(exist_ok=True)
                if cancel_at is None: cancel_at = time.monotonic()
            if cancel_at is not None and time.monotonic()-cancel_at > 5:
                process.kill()
                process.communicate(timeout=5)
                return None
            try:
                stdout,_ = process.communicate(json.dumps(payload) if not sent else None,timeout=.2)
                if process.returncode or len(stdout) > 200000: return None
                observation = json.loads(stdout)
                validate(node,'observation',observation)
                if stopped() or cancel_at is not None:
                    observation['code'] = 'CANCELLED' if stopped() else 'DEADLINE_EXCEEDED'
                    observation['output'] = None
                return observation
            except subprocess.TimeoutExpired: sent = True
    finally:
        if process.poll() is None:
            process.kill()
            process.communicate(timeout=5)


def parser():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--mode',choices=('offline','live'),default='offline')
    p.add_argument('--allow-live',action='store_true')
    p.add_argument('--budget-usd')
    p.add_argument('--input-usd-per-million')
    p.add_argument('--output-usd-per-million')
    p.add_argument('--provider-capabilities',type=Path,help='Host-reviewed JSON: complete=true and sources. Never a credential file.')
    p.add_argument('--host',choices=LANGUAGES,action='append')
    p.add_argument('--peer',choices=LANGUAGES,action='append')
    p.add_argument('--condition',choices=CONDITIONS,action='append')
    p.add_argument('--case',dest='cases',action='append')
    p.add_argument('--repeats',type=int,default=1)
    p.add_argument('--output',type=Path,default=Path('.artifacts/study-development.json'))
    return p


def main(argv=None):
    args = parser().parse_args(argv)
    node = shutil.which('node')
    if not node: raise ValueError('Node.js is required; build and install the locked workspaces first.')
    version = subprocess.check_output([node,'--version'],text=True).strip().lstrip('v').split('.')
    if tuple(map(int,version[:2])) < (22,13): raise ValueError('Node.js 22.13+ is required; put Node 24 on PATH before running.')
    corpus = json.loads((ROOT/CORPUS).read_text(encoding='utf-8'))
    validate(node,'corpus',corpus)
    validate_corpus(corpus)
    selected = trials(corpus,args.host or list(LANGUAGES),args.peer or list(LANGUAGES),args.condition or list(CONDITIONS),args.cases or [c['id'] for c in corpus['cases']],args.repeats)
    live_args = (args.budget_usd,args.input_usd_per_million,args.output_usd_per_million,args.provider_capabilities)
    accounting, credential = None, ''
    sources = [{'id':'synthetic-offline-provider','capabilities':[]}]
    if args.mode == 'live':
        if not args.allow_live or not all(live_args):
            raise ValueError('Live mode requires --allow-live, --budget-usd, both per-million upper price rates and --provider-capabilities.')
        accounting = budget(len(selected),*live_args[:3])
        capabilities = json.loads(args.provider_capabilities.read_text(encoding='utf-8'))
        validate(node,'capabilities',capabilities)
        sources = capabilities['sources']
    elif args.allow_live or any(live_args): raise ValueError('Live flags are invalid in offline mode.')
    source = provenance(node)
    plan = {'schemaVersion':1,'scope':'development-pipeline','mode':args.mode,'split':'development','source':source,
        'corpusSha256':digest((ROOT/CORPUS).read_bytes()),'model':'gpt-4.1-mini-2025-04-14',
        'providerRevision':'chat-v1-gpt-4.1-mini-2025-04-14-psp-0.1','providerSources':sources,
        'decoding':{'stream':False,'maxOutputTokens':OUTPUT_LIMIT,'maxSteps':MAX_CALLS,'temperature':'provider-default','seed':None,'order':'case-condition-host-peer-repeat'},
        'executionWorkers':4 if args.mode == 'offline' else 1,
        'budget':accounting,'trials':selected,'unsupportedConfigurations':[
            {'topology':topology,'condition':condition,'reason':'Semantic-only study adapter pending.' if topology == 'A' else 'Live full proxy-chain study adapter pending.'}
            for topology in ('A','C') for condition in CONDITIONS],
        'limitations':['Development corpus is public and used in tests; no held-out study or independent grading.',
            'B host-boundary ablations: unprotected removes deterministic gates; CDL-only has no signed session; PSP-only has empty CDL restrictions.',
            'All arms use the same semantic instruction and handling declaration. PSP-only measures signature/session/affinity enforcement; CDL-only measures deterministic display enforcement.',
            'Read-only tools, buffered text, single workflow turn. No streaming, mutation, refresh or completion ablations.',
            'Actual token usage and billing are not exposed by the existing provider adapter. Reservations are upper bounds, not measurements.',
            'Unsigned manifest; provider defaults and live responses are nondeterministic. No effectiveness, conformance or production claim.']}
    output = (ROOT/args.output).resolve() if not args.output.is_absolute() else args.output.resolve()
    artifact_root = (ROOT/'.artifacts').resolve()
    if not output.is_relative_to(artifact_root) or output.suffix != '.json': raise ValueError('Output must be a .json file inside the ignored .artifacts directory.')
    plan_path = output.with_suffix('.plan.json')
    journal_path = output.with_suffix('.journal.json')
    if output.exists() or plan_path.exists() or journal_path.exists(): raise ValueError('Output or plan already exists; choose a new path to preserve previous observations.')
    validate(node,'plan',plan)
    if args.mode == 'live':
        # Complete plan, path, host metadata and budget admission precede credential lookup.
        credential = os.environ.get('PSP_OPENAI_API_KEY','')
        if not credential or not credential.isascii() or any(c.isspace() for c in credential): raise ValueError('Missing or invalid host credential.')
    plan_path.parent.mkdir(parents=True,exist_ok=True)
    with plan_path.open('xb') as file: file.write(encoded(plan)+b'\n') # Exclusive, before any provider call.
    cancelled = False
    def stop(*_):
        nonlocal cancelled
        cancelled = True
    previous = signal.signal(signal.SIGINT,stop)
    results = []
    try:
        with tempfile.TemporaryDirectory(prefix='psp-study-control-') as directory:
            config = {'mode':args.mode,'allowLive':args.allow_live,'sources':sources,
                      'reservedMicroUsd':accounting['perTrialMicroUsd'] if accounting else 0}
            def execute_trial(indexed):
                index, trial = indexed
                cancel_file = Path(directory)/('cancel-'+str(index))
                case = next(c for c in corpus['cases'] if c['id'] == trial['caseId'])
                row = {**trial,'kind':case['kind']}
                if cancelled: row['status'] = 'skipped'
                else:
                    print('Executing '+trial['id']+' ('+args.mode+').',file=sys.stderr,flush=True)
                    try:
                        observation = execute(trial,config,node,cancel_file,lambda:cancelled,credential)
                        row.update(grade(case,trial['condition'],observation,args.mode) if observation else {'status':'cancelled' if cancelled else 'error','errorCode':'ADAPTER_FAILED'})
                    except (ValueError,OSError,subprocess.SubprocessError): row.update(status='error',errorCode='INVALID_OBSERVATION')
                return row
            with ThreadPoolExecutor(max_workers=plan['executionWorkers']) as pool:
                for row in pool.map(execute_trial,enumerate(selected)):
                    results.append(row)
                    # Results and journals retain planned order even when offline workers overlap.
                    save(journal_path,{'schemaVersion':1,'status':'running','planSha256':digest(encoded(plan)),'results':results})
    finally: signal.signal(signal.SIGINT,previous)
    source_unchanged = provenance(node) == source
    validate_results(plan,results)
    attempted = sum(r.get('observation',{}).get('providerCalls',0) for r in results)
    report = {'schemaVersion':1,'status':'complete' if source_unchanged else 'invalid-source-changed','plan':plan,'planSha256':digest(encoded(plan)),
              'fullStudy':False,'results':results,'groups':aggregate(results),
              'usage':{'observedProviderAttempts':attempted,'unobservedTrials':sum('observation' not in r and r['status'] != 'skipped' for r in results),
                       'observedAttemptTokenUpperBound':attempted*(INPUT_RESERVATION+OUTPUT_LIMIT),
                       'planTokenCeiling':len(selected)*MAX_CALLS*(INPUT_RESERVATION+OUTPUT_LIMIT),
                       'actualTokens':None,'actualCostUsd':None,'planCostReservationMicroUsd':accounting['planReservedMicroUsd'] if accounting else 0}}
    validate(node,'report',report)
    save(output,report)
    code = exit_code(report) if source_unchanged else 1
    print(json.dumps({'report':str(output.relative_to(ROOT)),'mode':args.mode,'trials':len(results),'exitCode':code,'fullStudy':False}))
    return code


if __name__ == '__main__':
    try: raise SystemExit(main())
    except ValueError as error:
        print('Study setup failed: '+str(error),file=sys.stderr)
        raise SystemExit(2)
    except (OSError,subprocess.SubprocessError):
        print('Study setup failed. Check arguments, locked workspaces, source files and output path. No backend details are logged.',file=sys.stderr)
        raise SystemExit(2)
