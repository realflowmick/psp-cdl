# SPDX-License-Identifier: Apache-2.0
"""Prepare, collect and analyze bounded synthetic multi-turn experiments."""
import argparse
import csv
import hashlib
import json
import os
import random
import secrets
import subprocess
import sys
from pathlib import Path
from psp_cdl_core import parse_json, canonical_json
from campaign_provider import INPUT_RESERVATION, MODELS, ready, require, CampaignError
from campaign_engine import episode
from campaign_analysis import summarize
from joint_interpreter import read, encoded, digest, write_new, source_paths, file_digest

ROOT = Path(__file__).resolve().parents[1]
CORPUS = 'conformance/vectors/evaluation/campaign-corpus-0.1.json'


def validate(kind, value):
    r = subprocess.run(['node', 'scripts/validate-campaign.mjs'], cwd=ROOT, input=json.dumps({'kind': kind, 'value': value}),
                       capture_output=True, text=True, encoding='utf-8', timeout=30)
    require(r.returncode == 0, 'INVALID_'+kind.upper())


def pins():
    paths = set(source_paths())
    for pattern in ('scripts/campaign*', 'scripts/validate-campaign.mjs', 'scripts/generate-campaign-contract.py',
                    'schemas/campaign*', 'evaluation/campaign*', 'conformance/vectors/evaluation/campaign*.json'):
        paths.update(p.relative_to(ROOT).as_posix() for p in ROOT.glob(pattern) if p.is_file())
    return [{'path': p, 'sha256': file_digest(p)} for p in sorted(paths)]


def artifact(path):
    p = Path(path).resolve(); root = (ROOT/'.artifacts').resolve()
    require(p.is_relative_to(root) and p != root, 'OUTPUT_OUTSIDE_ARTIFACTS')
    return p


def plan_for(config, corpus):
    cases = {c['id']: c for c in corpus['cases']}
    require(len(cases) == len(corpus['cases']) and set(config['caseIds']) <= set(cases), 'INVALID_CASE_IDS')
    plan = []
    for repeat in range(config['repeats']):
        for case in config['caseIds']:
            for language in config['languages']:
                for condition in config['conditions']:
                    plan.append({'id': 'episode-'+str(len(plan)+1).zfill(6), 'caseId': case, 'repeat': repeat, 'language': language, 'condition': condition})
    require(len(plan) <= 1024, 'PLAN_TOO_LARGE')
    random.Random(config['seed']).shuffle(plan)
    return plan


def reservation(bundle):
    config = bundle['config']; l = config['limits']; cases = {c['id']: c for c in bundle['corpus']['cases']}
    calls = {r: 0 for r in config['roles']}
    for p in bundle['plan']:
        calls['defender'] += l['maxTurns']*l['maxDefenderCallsPerTurn']; calls['referee'] += l['maxTurns']
        if config['mode'] == 'adaptive' and cases[p['caseId']]['kind'] == 'attack': calls['attacker'] += l['maxTurns']
    cost = 0
    for role, count in calls.items():
        p = config['roles'][role]
        cost += count*((INPUT_RESERVATION*p['inputMicroUsdPerMillion']+l['maxOutputTokens']*p['outputMicroUsdPerMillion']+999999)//1000000)
    return {'maxCalls': calls, 'reservedMicroUsd': cost, 'inputTokenReservationPerCall': INPUT_RESERVATION}


def verify(bundle):
    require(set(bundle) == {'profile', 'config', 'corpus', 'sources', 'nonce', 'plan', 'reservation', 'runtime'}, 'INVALID_BUNDLE')
    require(bundle['profile'] == 'PSP-CAMPAIGN-0.1' and type(bundle['nonce']) is str and len(bundle['nonce']) == 64, 'INVALID_BUNDLE')
    validate('config', bundle['config']); validate('corpus', bundle['corpus'])
    require(bundle['plan'] == plan_for(bundle['config'], bundle['corpus']), 'PLAN_DRIFT')
    require(bundle['sources'] == pins(), 'SOURCE_DRIFT')
    require(bundle['reservation'] == reservation(bundle), 'BUDGET_DRIFT')
    require(bundle['runtime'] == runtime(), 'RUNTIME_DRIFT')
    for p in bundle['config']['roles'].values(): require(p['model'] == MODELS[p['provider']], 'UNSUPPORTED_MODEL')
    for role in ('attacker', 'referee'):
        require(bundle['config']['roles'][role]['model'] == 'claude-opus-4-8', 'OPUS_REQUIRED')


def runtime():
    node = subprocess.check_output(['node', '--version'], text=True, timeout=10).strip()
    require(int(node.lstrip('v').split('.')[0]) >= 22 and sys.version_info >= (3, 12), 'UNSUPPORTED_RUNTIME')
    return {'python': sys.version, 'node': node}


def prepare(args):
    config = parse_json(canonical_json(read(args.config))); corpus = read(args.corpus); validate('config', config); validate('corpus', corpus)
    npm = 'npm.cmd' if os.name == 'nt' else 'npm'
    r = subprocess.run([npm, 'run', 'build'], cwd=ROOT, capture_output=True, timeout=180)
    require(r.returncode == 0, 'BUILD_FAILED')
    bundle = {'profile': 'PSP-CAMPAIGN-0.1', 'config': config, 'corpus': corpus, 'sources': pins(), 'runtime': runtime(), 'nonce': secrets.token_hex(32), 'plan': plan_for(config, corpus)}
    bundle['reservation'] = reservation(bundle); verify(bundle); write_new(artifact(args.output), bundle)
    return {'bundle': str(artifact(args.output)), 'sha256': digest(bundle), 'episodes': len(bundle['plan']), **bundle['reservation']}


def live_check(bundle, approved_digest):
    require(approved_digest == digest(bundle), 'BUNDLE_NOT_ADMITTED')
    config = bundle['config']
    for p in config['roles'].values():
        ready(p)
        require(p['inputMicroUsdPerMillion'] > 0 and p['outputMicroUsdPerMillion'] > 0, 'RATES_REQUIRED')
        key = os.environ.get('ANTHROPIC_API_KEY' if p['provider'] == 'anthropic' else 'PSP_OPENAI_API_KEY', '')
        require(bool(key) and '\r' not in key and '\n' not in key, 'CREDENTIAL_MISSING')
    require(0 < bundle['reservation']['reservedMicroUsd'] <= config['limits']['budgetMicroUsd'], 'BUDGET_TOO_SMALL')


def load_records(path):
    records = []
    with Path(path).open(encoding='utf-8') as stream:
        for line in stream:
            require(len(line.encode('utf-8')) <= 4*1024*1024, 'JOURNAL_TOO_LARGE')
            try: records.append(parse_json(line))
            except Exception:
                # Only an interrupted final write may be incomplete.
                require(not line.endswith('\n') and not stream.read(), 'CORRUPT_JOURNAL')
    return records


def export_summary(directory, bundle, records, mode):
    report = {**summarize(bundle, records), 'collectionMode': mode, 'bundleDigest': digest(bundle)}
    (directory/'summary.json').write_bytes(encoded(report))
    fields = ['language', 'condition', 'kind', *report['groups'][0]['curve'][0]]
    with (directory/'turns.csv').open('w', encoding='utf-8', newline='') as f:
        writer = csv.DictWriter(f, fieldnames=fields); writer.writeheader()
        for group in report['groups']:
            for row in group['curve']: writer.writerow({**{k: group[k] for k in ('language', 'condition', 'kind')}, **row})
    return report


def collect(args):
    bundle = read(args.bundle); verify(bundle); directory = artifact(args.output); live = args.live
    if live: live_check(bundle, args.admit_digest)
    else: require(args.admit_digest is None, 'INVALID_ADMISSION')
    directory.mkdir(parents=True, exist_ok=False)
    write_new(directory/'bundle.json', bundle)
    write_new(directory/'manifest.json', {'profile': bundle['profile'], 'mode': 'live' if live else 'offline-scripted',
              'bundleDigest': digest(bundle), 'plannedEpisodes': len(bundle['plan']), 'status': 'collection-started'})
    if live:
        # A prepared allowance is single-use, including interrupted collections.
        write_new(artifact('.artifacts/campaign-admissions/'+digest(bundle)+'.json'), {'output': str(directory)})
    try:
        with (directory/'journal.jsonl').open('x', encoding='utf-8', buffering=1) as journal:
            def emit(value):
                line = json.dumps(value, ensure_ascii=False, allow_nan=False)+'\n'
                require(len(line.encode('utf-8')) <= 4*1024*1024, 'JOURNAL_TOO_LARGE')
                journal.write(line); journal.flush(); os.fsync(journal.fileno())
            for index, plan in enumerate(bundle['plan']):
                if (directory/'CANCEL').exists(): break
                print(f"{index+1}/{len(bundle['plan'])} {plan['id']} {plan['language']} {plan['condition']} {plan['caseId']}", file=sys.stderr, flush=True)
                outcome = episode(bundle, plan, directory, live, emit)
                if outcome.get('code') in ('CANCELLED', 'WORKER_TIMEOUT', 'WORKER_EXITED', 'CREDENTIAL_MISSING',
                                           'PROVIDER_HTTP_ERROR', 'PROVIDER_FAILED', 'MODEL_MISMATCH', 'DEADLINE_EXCEEDED'):
                    break
    except KeyboardInterrupt:
        (directory/'CANCEL').touch()
    finally:
        records = load_records(directory/'journal.jsonl') if (directory/'journal.jsonl').exists() else []
        report = export_summary(directory, bundle, records, 'live' if live else 'offline-scripted')
        manifest = read(directory/'manifest.json')
        manifest.update(status='collection-closed', completeEpisodes=sum(e['complete'] for e in report['episodes']),
                        cancelled=(directory/'CANCEL').exists(), journalSha256=hashlib.sha256((directory/'journal.jsonl').read_bytes()).hexdigest())
        (directory/'manifest.json').write_bytes(encoded(manifest))
    complete = sum(e['complete'] for e in report['episodes'])
    return {'output': str(directory), 'status': 'complete' if complete == len(bundle['plan']) else 'incomplete',
            'planned': len(bundle['plan']), 'complete': complete, 'collectionMode': report['collectionMode']}


def main():
    parser = argparse.ArgumentParser(description=__doc__); sub = parser.add_subparsers(dest='command', required=True)
    p = sub.add_parser('prepare'); p.add_argument('--config', default='evaluation/campaign-config.example.json'); p.add_argument('--corpus', default=CORPUS); p.add_argument('--output', required=True)
    p = sub.add_parser('inspect'); p.add_argument('--bundle', required=True)
    p = sub.add_parser('run'); p.add_argument('--bundle', required=True); p.add_argument('--output', required=True); p.add_argument('--live', action='store_true'); p.add_argument('--admit-digest')
    p = sub.add_parser('analyze'); p.add_argument('--input', required=True)
    args = parser.parse_args()
    try:
        if args.command == 'prepare': result = prepare(args)
        elif args.command == 'inspect':
            bundle = read(args.bundle); verify(bundle); result = {'sha256': digest(bundle), 'episodes': len(bundle['plan']), **bundle['reservation']}
        elif args.command == 'run': result = collect(args)
        else:
            d = artifact(args.input); bundle = read(d/'bundle.json'); require(read(d/'manifest.json')['bundleDigest'] == digest(bundle), 'BUNDLE_DRIFT')
            manifest = read(d/'manifest.json')
            if 'journalSha256' in manifest:
                require(manifest['journalSha256'] == hashlib.sha256((d/'journal.jsonl').read_bytes()).hexdigest(), 'JOURNAL_DRIFT')
            export_summary(d, bundle, load_records(d/'journal.jsonl'), read(d/'manifest.json')['mode']); result = {'summary': str(d/'summary.json')}
        print(json.dumps(result, indent=2))
        if args.command == 'run' and result['status'] != 'complete': return 2
    except Exception as exc:
        print(json.dumps({'error': getattr(exc, 'code', str(exc) if isinstance(exc, (ValueError, FileExistsError)) else 'COLLECTION_ERROR')})); return 2
    return 0


if __name__ == '__main__': sys.exit(main())
