# SPDX-License-Identifier: Apache-2.0
"""Prepare, execute or finalize a pinned pilot; offline rehearsal is the default."""
import argparse
import json
import shutil
import subprocess
from pathlib import Path
from heldout import (read, write, artifact, make_bundle, run, finalize, locked, run_directory, pilot_digest)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command',required=True)
    prepare = commands.add_parser('prepare')
    prepare.add_argument('--plan',type=Path,required=True)
    prepare.add_argument('--mode',choices=('offline','live'),default='offline')
    prepare.add_argument('--output',type=Path,required=True)
    for flag in ('budget-usd','input-usd-per-million','output-usd-per-million'): prepare.add_argument('--'+flag)
    for flag in ('provider-capabilities','corpus-provenance','rubric-review','preregistration'): prepare.add_argument('--'+flag,type=Path)
    execute = commands.add_parser('run')
    execute.add_argument('--allow-live',action='store_true')
    execute.add_argument('--operator-admission',type=Path)
    recover = commands.add_parser('finalize')
    for command in (prepare,execute,recover): command.add_argument('--corpus',type=Path,required=True)
    for command in (prepare,execute): command.add_argument('--rehearsal',type=Path)
    for command in (execute,recover): command.add_argument('--bundle',type=Path,required=True)
    args = parser.parse_args(argv)
    node = shutil.which('node')
    if node is None: raise ValueError('Missing Node')
    version = subprocess.check_output([node,'--version'],text=True).strip().lstrip('v').split('.')
    if tuple(map(int,version[:2])) < (22,13): raise ValueError('Unsupported Node')
    corpus = read(args.corpus)
    if args.command == 'prepare':
        live, reviews = None,None
        flags = (args.budget_usd,args.input_usd_per_million,args.output_usd_per_million,args.provider_capabilities,
                 args.corpus_provenance,args.rubric_review,args.preregistration)
        if args.mode == 'live':
            if not all(flags): raise ValueError('Missing live preparation inputs')
            live = {'ceiling':args.budget_usd,'inputRate':args.input_usd_per_million,'outputRate':args.output_usd_per_million,
                    'capabilities':read(args.provider_capabilities)}
            reviews = {'corpusProvenance':args.corpus_provenance,'rubricReview':args.rubric_review,'preregistration':args.preregistration}
        elif any(flags): raise ValueError('Live options in offline mode')
        output = artifact(args.output)
        bundle = make_bundle(read(args.plan),corpus,args.mode,node,read(args.rehearsal) if args.rehearsal else None,live,reviews)
        write(output,bundle,True)
        print(json.dumps({'bundle':str(output),'bundleSha256':pilot_digest(bundle),'mode':bundle['mode'],'trials':len(bundle['plan']['trials']),
                          'executionAuthorized':False,'fullStudy':False}))
        return 0
    bundle = read(args.bundle)
    if args.command == 'run':
        manifest = run(bundle,corpus,node,read(args.rehearsal) if args.rehearsal else None,
                       read(args.operator_admission) if args.operator_admission else None,args.allow_live)
    else:
        directory = run_directory(bundle)
        with locked(directory): manifest = finalize(bundle,corpus,directory,node,True)
    statuses = {s:sum(g['statuses'][s] for g in manifest['groups']) for s in ('observed','error','cancelled','skipped')}
    code = 1 if manifest['status'] != 'finalized' or statuses['error'] else 2 if statuses['cancelled'] or statuses['skipped'] else 0
    print(json.dumps({'manifest':str(run_directory(bundle)/'manifest.json'),'mode':manifest['mode'],'status':manifest['status'],
                      'statuses':statuses,'fullStudy':False,'independentReview':False,'exitCode':code}))
    return code


if __name__ == '__main__':
    try: raise SystemExit(main())
    except (OSError,ValueError,KeyError,TypeError,subprocess.SubprocessError):
        print(json.dumps({'status':'rejected','code':'INVALID_HELDOUT_INPUT_OR_STATE','executionAuthorized':False}))
        raise SystemExit(2)
