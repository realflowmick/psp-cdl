# SPDX-License-Identifier: Apache-2.0
"""Offline pilot tools. Plans and analyses never authorize a run or independent claims."""
import argparse
import json
from pathlib import Path
from psp_cdl_core import parse_json, canonical_json
from psp_cdl_test_harness import create_pilot_plan, analyze_pilot, pilot_digest, PilotError

ROOT = Path(__file__).resolve().parents[1]


def read(path):
    with path.open('rb') as source:
        content = source.read(4194305)
    if len(content) > 4194304: raise ValueError('Input limit exceeded')
    return parse_json(content.decode('utf-8',errors='strict'))


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command',required=True)
    plan = commands.add_parser('plan')
    plan.add_argument('--request',type=Path,required=True)
    analysis = commands.add_parser('analyze')
    analysis.add_argument('--plan',type=Path,required=True)
    analysis.add_argument('--outcomes',type=Path,required=True)
    for command in (plan,analysis): command.add_argument('--output',type=Path,required=True)
    args = parser.parse_args(argv)
    try:
        output = args.output.resolve()
        artifact_root = ROOT/'.artifacts'
        if artifact_root.resolve() != artifact_root or not output.is_relative_to(artifact_root) or output.suffix != '.json':
            raise ValueError('Invalid output path')
        result = create_pilot_plan(read(args.request)) if args.command == 'plan' else analyze_pilot(read(args.plan),read(args.outcomes))
        content = (canonical_json(result)+'\n').encode('utf-8')
        output.parent.mkdir(parents=True,exist_ok=True)
        with output.open('xb') as target: target.write(content)
        print(json.dumps({'output':output.relative_to(ROOT).as_posix(),'sha256':pilot_digest(result),
                          'scope':result['scope'],'executionAuthorized':False,'fullStudy':False}))
        return 0
    except (OSError,ValueError,TypeError) as error:
        print(json.dumps({'status':'rejected','code':error.code if isinstance(error,PilotError) else 'INVALID_INPUT_OR_OUTPUT','executionAuthorized':False}))
        return 2


if __name__ == '__main__': raise SystemExit(main())
