# SPDX-License-Identifier: Apache-2.0
"""Execute every offline study cell and compare actual observations across languages."""
import json
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def main():
    artifacts = ROOT/'.artifacts'
    artifacts.mkdir(exist_ok=True)
    # A unique ignored directory preserves prior reports and supports repeated checks.
    directory = Path(tempfile.mkdtemp(prefix='study-parity-',dir=artifacts))
    output = directory/'report.json'
    subprocess.run([sys.executable,'scripts/run-study.py','--output',str(output)],cwd=ROOT,check=True)
    report = json.loads(output.read_text(encoding='utf-8'))
    if len(report['results']) != 96: raise ValueError('Incomplete study matrix')
    groups = {}
    for row in report['results']:
        if row['status'] != 'observed' or row['offlineExpectationMatched'] is not True: raise ValueError('Study observation failed')
        key = (row['caseId'],row['condition'],row['repeat'])
        observation = {k:v for k,v in row['observation'].items() if k != 'elapsedMs'}
        value = {'observation':observation,'outcome':row['outcome']}
        if key in groups and groups[key] != value: raise ValueError('Cross-language study observations differ: '+str(key))
        groups[key] = value
    print('Study parity passed: 96 trials, four language pairs, four conditions. Offline pipeline evidence only. Report: '+str(output.relative_to(ROOT)))


if __name__ == '__main__': main()
