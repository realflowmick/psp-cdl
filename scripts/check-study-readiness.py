# SPDX-License-Identifier: Apache-2.0
"""Inspect the draft pilot's evidence without network access, credentials or execution."""
import argparse
import json
from pathlib import Path
from study_readiness import inspect_candidate

ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--candidate',type=Path,default=ROOT/'evaluation/study-candidate.json')
    args = parser.parse_args()
    try:
        result = inspect_candidate(json.loads(args.candidate.read_text(encoding='utf-8')),ROOT)
    except (ValueError,KeyError,TypeError,OSError):
        print(json.dumps({'status':'invalid-candidate','executionAuthorized':False}))
        return 1
    print(json.dumps(result,indent=2))
    return 2 if result['blockers'] else 0


if __name__ == '__main__': raise SystemExit(main())
