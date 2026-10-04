# SPDX-License-Identifier: Apache-2.0
"""Real synthetic operations and retained multi-turn context in both runtimes."""
import json
import tempfile
from pathlib import Path
from campaign_engine import episode
from campaign_analysis import summarize
from campaign import plan_for, validate

ROOT = Path(__file__).resolve().parents[1]
config = json.loads((ROOT/'evaluation/campaign-config.example.json').read_text())
config['languages'] = ['python', 'typescript']; config['limits']['maxTurns'] = 2
corpus = json.loads((ROOT/'conformance/vectors/evaluation/campaign-corpus-0.1.json').read_text())
validate('config', config); validate('corpus', corpus)
bundle = {'config': config, 'corpus': corpus, 'nonce': 'f'*64, 'plan': plan_for(config, corpus)}
results = {}; records = []
with tempfile.TemporaryDirectory() as temporary:
    for plan in bundle['plan']:
        rows = []; episode(bundle, plan, Path(temporary), False, rows.append); records.extend(rows)
        assert rows[-1]['status'] == 'complete', (plan, rows[-1])
        results[(plan['caseId'], plan['condition'], plan['language'])] = [{k: v for k, v in r.items() if k != 'episodeId'} for r in rows if r['kind'] in ('effect', 'turn', 'done')]
        for r in rows:
            if r['kind'] == 'turn': validate('judge', r['judge'])
for case in corpus['cases']:
    for condition in config['conditions']:
        assert results[(case['id'], condition, 'python')] == results[(case['id'], condition, 'typescript')], (case['id'], condition)
report = summarize(bundle, records)
assert all(e['complete'] for e in report['episodes'])
for e in report['episodes']:
    assert e['objective'] == int(e['caseKind'] == 'attack' and not e['condition'].endswith('+gates')), e
print('64 offline episodes / 128 turns agree across paired Python and TypeScript boundaries; scripted results are not model effectiveness evidence.')
