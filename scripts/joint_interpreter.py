# SPDX-License-Identifier: Apache-2.0
"""Pinned, bounded development runner. Never a PSP condition interpreter."""
import argparse
import hashlib
import json
import os
import subprocess
import sys
from pathlib import Path
from interpreter_validation import grade_case

ROOT = Path(__file__).resolve().parents[1]
PROFILE = 'PSP-JOINT-VALIDATION-0.1'
SUITE = 'conformance/vectors/llm/interpreter-validation-0.1.json'
MAX_JSON_BYTES = 32 * 1024 * 1024


def require(ok, code):
    if not ok:
        raise ValueError(code)


def read(path):
    path = Path(path)
    require(path.stat().st_size <= MAX_JSON_BYTES, 'DOCUMENT_TOO_LARGE')
    def unique(pairs):
        value = {}
        for k, v in pairs:
            require(k not in value, 'DUPLICATE_KEY')
            value[k] = v
        return value
    return json.loads(path.read_text(encoding='utf-8'), object_pairs_hook=unique,
                      parse_constant=lambda _: require(False, 'INVALID_NUMBER'))


def encoded(value):
    return (json.dumps(value, sort_keys=True, ensure_ascii=False, indent=2, allow_nan=False)+'\n').encode('utf-8')


def digest(value):
    return hashlib.sha256(encoded(value)).hexdigest()


def write_new(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open('xb') as stream:
        stream.write(encoded(value))


def validate(kind, value):
    process = subprocess.run(['node', 'scripts/validate-interpreter.mjs'], cwd=ROOT,
                             input=json.dumps({'kind': kind, 'value': value}, ensure_ascii=False),
                             capture_output=True, text=True, encoding='utf-8', timeout=30)
    require(process.returncode == 0, 'INVALID_'+kind.upper())


def source_paths():
    # Bind executable implementation, loaded data, contracts and interpreter sources.
    paths = {SUITE, 'schemas/interpreter-validation-0.1.schema.json', 'package-lock.json', 'uv.lock',
             'examples/in-context/validation/application.psp', 'conformance/requirements.json'}
    for pattern in ('implementations/typescript/packages/*/src/**/*',
                    'implementations/typescript/packages/*/dist/**/*',
                    'implementations/python/packages/*/src/**/*',
                    'specs/profiles/*.md', 'specs/psp/RFC-PSP-CORE-v3_2_0.md', 'specs/cdl/RFC-CDL-v1_5.md',
                    'docs/reviews/*interpreter*.json', 'specs/systemprompts/*Interpreter-draft-0_1.md'):
        paths.update(p.relative_to(ROOT).as_posix() for p in ROOT.glob(pattern)
                     if p.is_file() and p.suffix in ('.ts', '.js', '.py', '.json', '.sql', '.md'))
    paths.update('scripts/'+p for p in (
        'joint_interpreter.py', 'interpreter_validation.py', 'interpreter-validation.mjs',
        'interpreter_worker.py', 'interpreter-worker.mjs', 'validate-interpreter.mjs',
        'context_service_fixtures.py', 'context-service-fixtures.mjs', 'llm_fixtures.py',
        'llm-fixtures.mjs', 'dispatch_fixtures.py', 'dispatch-fixtures.mjs'))
    paths.update(('conformance/vectors/llm/context-service-0.1.json',
                  'conformance/vectors/llm/loop-0.1.json', 'conformance/vectors/dispatch/gate-0.1.json'))
    return sorted(paths)


def file_digest(path):
    # Same text pins on Windows/Linux; all inventoried files are UTF-8 text.
    return hashlib.sha256((ROOT/path).read_text(encoding='utf-8').encode('utf-8')).hexdigest()


def pins():
    return [{'path': p, 'sha256': file_digest(p)} for p in source_paths()]


def verify_bundle(bundle):
    validate('bundle', bundle)
    require(bundle['sources'] == pins(), 'SOURCE_DRIFT')
    limits = bundle['provider']['limits']
    require(limits['budgetTokens'] >= limits['maxCalls'] * (1047576+limits['maxOutputTokens']), 'BUDGET_TOO_SMALL')


def prepare(path, selected=None):
    # Build before pinning both source and the actual JS consumed by the workers.
    npm = 'npm.cmd' if os.name == 'nt' else 'npm'
    result = subprocess.run([npm, 'run', 'build'], cwd=ROOT, capture_output=True, timeout=180)
    require(result.returncode == 0, 'BUILD_FAILED')
    cases = [c['id'] for c in read(ROOT/SUITE)['cases']]
    bundle = {'profile': PROFILE, 'cases': selected or cases, 'sources': pins(),
              'provider': {'model': 'gpt-4.1-mini-2025-04-14', 'transcriptProfile': 'PSP-OPENAI-CONTEXT-0.1', 'complete': False, 'sources': [],
                           'limits': read(ROOT/SUITE)['providerLimits']},
              'workerTimeoutSeconds': 120}
    verify_bundle(bundle)
    write_new(path, bundle)
    return {'status': 'prepared', 'bundleDigest': digest(bundle), 'cases': len(bundle['cases']),
            'liveReady': False, 'reason': 'Review actual provider capabilities and set complete before admitting live execution.'}


def inventory(selected):
    cases = read(ROOT/SUITE)['cases']
    out = []
    for protocol in ('psp', 'cdl'):
        for scenario in read(ROOT/f'docs/reviews/{protocol}-interpreter-scenarios-0.1.json')['scenarios']:
            ref = protocol+':'+scenario['id']
            related = [c['id'] for c in cases if ref in c['reviewRefs']]
            out.append({'id': ref, 'scenarioStatus': 'not-run', 'relatedCases': related,
                        'selectedCases': [c for c in related if c in selected],
                        'coverage': 'partial-variant' if related else 'not-wired',
                        'remaining': 'Original scenario requires exact setup and separate semantic review; variants do not discharge it.'
                        if related else 'No executable joint fixture yet; required service/profile semantics must be supplied or explicitly marked unsupported.'})
    require(len(out) == 68 and len({r['id'] for r in out}) == 68, 'SCENARIO_INVENTORY_CHANGED')
    return out


def worker(case_id, mode, language, bundle, output):
    command = ['node', 'scripts/interpreter-worker.mjs'] if language == 'typescript' else [sys.executable, 'scripts/interpreter_worker.py']
    if mode == 'live':
        command.append('--allow-live')
    request = {'caseId': case_id, 'mode': mode, 'provider': bundle['provider']}
    env = os.environ.copy()
    if mode == 'rehearsal':
        env.pop('PSP_OPENAI_API_KEY', None)
    # Redirect output to local ignored evidence, not the terminal. Never expose raw exception text.
    with output.open('xb') as stream:
        proc = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=stream, stderr=subprocess.DEVNULL, env=env, cwd=ROOT)
        try:
            proc.communicate(json.dumps(request).encode('utf-8'), timeout=bundle['workerTimeoutSeconds'])
        except (subprocess.TimeoutExpired, KeyboardInterrupt) as exc:
            proc.kill()
            proc.communicate()
            return None, 'CANCELLED' if isinstance(exc, KeyboardInterrupt) else 'WORKER_TIMEOUT'
    if proc.returncode != 0:
        return None, 'WORKER_FAILED'
    try:
        observation = read(output)
        validate('observation', observation)
        require((observation['caseId'], observation['mode'], observation['language']) == (case_id, mode, language), 'WORKER_BINDING_MISMATCH')
        return observation, None
    except (ValueError, OSError):
        return None, 'INVALID_OBSERVATION'


def run(bundle_path, output, mode='rehearsal', language='python', allow_live=False, approved_digest=None):
    bundle = read(bundle_path)
    verify_bundle(bundle)
    require(mode in ('rehearsal', 'live') and language in ('typescript', 'python'), 'INVALID_MODE')
    if mode == 'live':
        require(allow_live and approved_digest == digest(bundle), 'LIVE_NOT_ADMITTED')
        require(bundle['provider']['complete'] is True and bundle['provider']['sources'], 'PROVIDER_NOT_REVIEWED')
    else:
        require(not allow_live and approved_digest is None, 'INVALID_ADMISSION')
    output = Path(output).resolve()
    require(output.is_relative_to((ROOT/'.artifacts').resolve()), 'OUTPUT_MUST_BE_IGNORED_ARTIFACT')
    output.mkdir(parents=True, exist_ok=False)
    write_new(output/'bundle.json', bundle)
    report = {'profile': PROFILE, 'bundleDigest': digest(bundle), 'mode': mode, 'language': language,
              'status': 'running', 'cases': [], 'inventory': inventory(bundle['cases']),
              'limits': {'maxCallsTotal': len(bundle['cases'])*bundle['provider']['limits']['maxCalls'],
                         'reservedTokensTotal': len(bundle['cases'])*bundle['provider']['limits']['budgetTokens']},
              'scope': 'Synthetic development observations. No full conformance, production-readiness or effectiveness claim.'}
    cases = {c['id']: c for c in read(ROOT/SUITE)['cases']}
    stop = None
    for case_id in bundle['cases']:
        row = {'caseId': case_id}
        if not stop:
            try:
                verify_bundle(bundle)
            except ValueError:
                stop = 'SOURCE_DRIFT'
        if stop:
            row.update(status='not-run', reason=stop)
        else:
            evidence = output/(case_id+'.json')
            observation, error = worker(case_id, mode, language, bundle, evidence)
            if error:
                row.update(status='error', reason=error)
                stop = error
            else:
                row.update(grade_case(cases[case_id], observation), status='observed',
                           evidence=evidence.name, evidenceSha256=hashlib.sha256(evidence.read_bytes()).hexdigest())
                # Recheck after every worker, including the final one.
                try:
                    verify_bundle(bundle)
                except ValueError:
                    stop = 'SOURCE_DRIFT'
                    row['status'] = 'invalid-source-changed'
        report['cases'].append(row)
        write_new(output/(case_id+'.grade.json'), row)
    report['status'] = 'invalid-source-changed' if stop == 'SOURCE_DRIFT' else 'error' if stop else (
        'failed' if any(r.get('boundaryStatus') != 'passed' for r in report['cases']) else 'rehearsal-passed' if mode == 'rehearsal' else 'needs-review')
    write_new(output/'report.json', report)
    return report


def review(run_path, review_path):
    directory = Path(run_path)
    report = read(directory/'report.json')
    decision = read(review_path)
    validate('review', decision)
    require(decision['reportSha256'] == hashlib.sha256((directory/'report.json').read_bytes()).hexdigest(), 'REPORT_MISMATCH')
    require(report['mode'] == 'live' and report['status'] in ('needs-review', 'failed'), 'NOT_REVIEWABLE_MODEL_EVIDENCE')
    bundle = read(directory/'bundle.json')
    verify_bundle(bundle)
    require(digest(bundle) == report['bundleDigest'], 'BUNDLE_MISMATCH')
    rows = {r['caseId']: r for r in report['cases']}
    require(len(rows) == len(report['cases']) == len(bundle['cases']) and set(rows) == set(bundle['cases']), 'REPORT_CASE_MISMATCH')
    require(len(decision['decisions']) == len(rows) and {r['caseId'] for r in decision['decisions']} == set(rows), 'INCOMPLETE_REVIEW')
    cases = {c['id']: c for c in read(ROOT/SUITE)['cases']}
    for d in decision['decisions']:
        row = rows[d['caseId']]
        require(row['evidence'] == d['caseId']+'.json', 'INVALID_EVIDENCE_PATH')
        path = directory/row['evidence']
        require(hashlib.sha256(path.read_bytes()).hexdigest() == row['evidenceSha256'], 'EVIDENCE_CHANGED')
        observation = read(path)
        validate('observation', observation)
        require(observation['mode'] == 'live' and observation['caseId'] == d['caseId'] and observation['language'] == report['language'], 'EVIDENCE_BINDING_MISMATCH')
        grade = grade_case(cases[d['caseId']], observation)
        require(all(row[k] == v for k, v in grade.items()), 'GRADE_CHANGED')
        require(d['verdict'] != 'pass' or grade['boundaryStatus'] == 'passed', 'CANNOT_OVERRIDE_FAILED_BOUNDARIES')
        for ref in d['evidence']:
            require(ref['index'] < len(observation['actual'][ref['collection']]), 'INVALID_EVIDENCE_REFERENCE')
    # Record a human attestation, not independent reviewer authentication or conformance.
    write_new(directory/'semantic-review.json', decision)
    return {'status': 'review-recorded', 'verdicts': {d['caseId']: d['verdict'] for d in decision['decisions']}}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='command', required=True)
    p = sub.add_parser('prepare')
    p.add_argument('--output', required=True)
    p.add_argument('--case', action='append', dest='selected')
    p = sub.add_parser('inspect')
    p.add_argument('--bundle', required=True)
    p = sub.add_parser('run')
    p.add_argument('--bundle', required=True)
    p.add_argument('--output', required=True)
    p.add_argument('--mode', choices=['rehearsal', 'live'], default='rehearsal')
    p.add_argument('--language', choices=['typescript', 'python'], default='python')
    p.add_argument('--allow-live', action='store_true')
    p.add_argument('--approved-digest')
    p = sub.add_parser('review')
    p.add_argument('--run', required=True)
    p.add_argument('--review', required=True)
    args = parser.parse_args()
    try:
        if args.command == 'prepare':
            result = prepare(args.output, args.selected)
        elif args.command == 'inspect':
            bundle = read(args.bundle)
            verify_bundle(bundle)
            result = {'status': 'verified', 'bundleDigest': digest(bundle), 'cases': bundle['cases'], 'provider': bundle['provider']}
        elif args.command == 'review':
            result = review(args.run, args.review)
        else:
            report = run(args.bundle, args.output, args.mode, args.language, args.allow_live, args.approved_digest)
            result = {k: report[k] for k in ('status', 'mode', 'language', 'bundleDigest', 'limits')}
            result['cases'] = [{k: r[k] for k in ('caseId', 'status', 'boundaryStatus', 'behaviorStatus', 'reason') if k in r} for r in report['cases']]
        print(json.dumps(result, ensure_ascii=False))
        return 0 if result['status'] in ('prepared', 'verified', 'rehearsal-passed', 'review-recorded') else 2
    except (ValueError, OSError, subprocess.SubprocessError, KeyError):
        print(json.dumps({'status': 'not-run', 'reason': 'INVALID_INPUT_OR_ADMISSION; inspect the bundle and local artifacts.'}))
        return 2


if __name__ == '__main__':
    raise SystemExit(main())
