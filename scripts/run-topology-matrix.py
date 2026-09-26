# SPDX-License-Identifier: Apache-2.0
"""Execute offline A/B/C adapters; account for every requirement without adopting it."""
import argparse
import json
import platform
import shutil
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from topology_matrix import LANGUAGES, assemble, combinations, digest, exit_code, index_observations, validate_inputs, validate_report

ROOT = Path(__file__).resolve().parents[1]
CORPUS = 'conformance/vectors/topologies/matrix-0.2.json'
MAPPINGS = 'conformance/workflow-mappings-0.2.json'


def git(*args): return subprocess.check_output(['git',*args],cwd=ROOT).decode('utf-8').strip()


def provenance(node):
    paths = ['implementations','scripts','conformance','schemas','specs/profiles','specs/psp','specs/cdl',
             'project.json','package.json','package-lock.json','pyproject.toml','uv.lock']
    files = sorted(set(git('ls-files','--cached','--others','--exclude-standard','--',*paths).splitlines()))
    records = [{'path':p,'sha256':digest((ROOT/p).read_bytes())} for p in files if (ROOT/p).is_file()]
    return {'commit':git('rev-parse','HEAD'),'sourceTree':{'modified':bool(git('status','--porcelain','--untracked-files=all','--',*paths)),
        'sha256':digest(json.dumps(records,sort_keys=True,separators=(',',':')).encode()),'files':records},
        'corpusSha256':digest((ROOT/CORPUS).read_bytes()),'inventorySha256':digest((ROOT/'conformance/requirements.json').read_bytes()),
        'mappingsSha256':digest((ROOT/MAPPINGS).read_bytes()),
        'runtime':{'node':subprocess.check_output([node,'--version'],text=True).strip(),'python':platform.python_version(),'platform':sys.platform}}


def validate(node, kind, value):
    result = subprocess.run([node,'scripts/validate-topology-matrix.mjs',kind],cwd=ROOT,input=json.dumps(value),capture_output=True,text=True,encoding='utf-8',timeout=15)
    if result.returncode: raise ValueError('Invalid matrix '+kind+': '+result.stderr[-1500:])


def run(suite, node, selected):
    runtimes = {'typescript':node,'python':sys.executable}
    def execute(combination):
        topology, host, proxy, server = combination
        adapter = 'scripts/topology-adapter.mjs' if host == 'typescript' else 'scripts/topology_adapter.py'
        script = ROOT/('scripts/topology-server.mjs' if server == 'typescript' else 'scripts/topology_server.py')
        proxy_script = ROOT/('scripts/topology-proxy.mjs' if proxy == 'typescript' else 'scripts/topology_proxy.py')
        command = [runtimes[host],adapter,topology,runtimes[server],str(script),runtimes[proxy] if proxy else '-',str(proxy_script) if proxy else '-']
        print('Executing '+str(combination)+' (offline).',file=sys.stderr,flush=True)
        try:
            process = subprocess.run(command,cwd=ROOT,capture_output=True,text=True,encoding='utf-8',timeout=180)
            entries = json.loads(process.stdout) if process.returncode == 0 else None
            validate(node,'adapter',entries)
            return combination,index_observations(entries,suite['cases'],topology)
        except (OSError,subprocess.SubprocessError,ValueError): return combination,None
    # Independent temporary stores/processes; bounded concurrency, stable output ordering.
    with ThreadPoolExecutor(max_workers=2) as pool:
        return dict(pool.map(execute,[c for c in combinations() if c in selected]))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output',type=Path)
    parser.add_argument('--check',action='store_true',help='Exit 0 only when every applicable offline A/B/C fixture passes. Whole-clause conformance stays pending.')
    parser.add_argument('--host',choices=LANGUAGES)
    parser.add_argument('--peer',choices=LANGUAGES)
    parser.add_argument('--proxy',choices=LANGUAGES,help='Filter C proxy implementations; A/B have no proxy.')
    parser.add_argument('--topology',choices=('A','B','C'))
    args = parser.parse_args()
    node = shutil.which('node')
    if not node or int(subprocess.check_output([node,'--version'],text=True).strip().lstrip('v').split('.')[0]) < 22:
        parser.error('Node >=22 is required for schema validation; no execution claimed.')
    suite = json.loads((ROOT/CORPUS).read_text(encoding='utf-8'))
    inventory = json.loads((ROOT/'conformance/requirements.json').read_text(encoding='utf-8'))
    mappings = json.loads((ROOT/MAPPINGS).read_text(encoding='utf-8'))
    validate(node,'suite',suite)
    validate(node,'mappings',mappings)
    validate_inputs(suite,inventory,mappings)
    before = provenance(node)
    selected = {c for c in combinations() if (not args.topology or c[0] == args.topology) and (not args.host or c[1] == args.host)
                and (not args.proxy or c[2] == args.proxy) and (not args.peer or c[3] == args.peer)}
    observations = run(suite,node,selected)
    if provenance(node) != before: observations = {c:None for c in selected}
    report = assemble(suite,inventory,mappings,before,observations,selected=selected)
    validate_report(suite,inventory,mappings,report)
    validate(node,'report',report)
    text = json.dumps(report,indent=2,ensure_ascii=False)+'\n'
    if args.output:
        args.output.parent.mkdir(parents=True,exist_ok=True)
        args.output.write_text(text,encoding='utf-8',newline='\n')
    else: print(text,end='')
    print(json.dumps({'scopePassed':report['scopePassed'],'fullConformance':False,**report['summary'],
        'requirements':report['requirements']['totalRequirements'],'mappedRequirements':report['requirements']['mappedRequirements']}),file=sys.stderr)
    return exit_code(report,args.check)


if __name__ == '__main__': raise SystemExit(main())
