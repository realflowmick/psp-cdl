# SPDX-License-Identifier: Apache-2.0
"""Run bounded offline adapters; emit a reproducible, explicitly scoped manifest."""
import argparse
import json
import platform
import shutil
import subprocess
import sys
from pathlib import Path
from topology_matrix import LANGUAGES, assemble, digest, exit_code, index_observations

ROOT = Path(__file__).resolve().parents[1]
CORPUS = "conformance/vectors/topologies/matrix-0.1.json"


def git(*args):
    return subprocess.check_output(["git", *args],cwd=ROOT).decode("utf-8").strip()


def provenance(node):
    # Excludes generated artifacts, tool runtimes and unrelated untracked documents.
    paths = ["implementations","scripts","conformance","schemas","specs/profiles","specs/psp","specs/cdl",
             "project.json","package.json","package-lock.json","pyproject.toml","uv.lock"]
    files = sorted(set(git("ls-files","--cached","--others","--exclude-standard","--",*paths).splitlines()))
    records = [{"path":path,"sha256":digest((ROOT/path).read_bytes())} for path in files if (ROOT/path).is_file()]
    return {"commit":git("rev-parse","HEAD"),"sourceTree":{"modified":bool(git("status","--porcelain","--untracked-files=all","--",*paths)),
        "sha256":digest(json.dumps(records,sort_keys=True,separators=(",",":")).encode()),"files":records},
        "corpusSha256":digest((ROOT/CORPUS).read_bytes()),"inventorySha256":digest((ROOT/"conformance/requirements.json").read_bytes()),
        "runtime":{"node":subprocess.check_output([node,"--version"],text=True).strip() if node else None,"python":platform.python_version(),"platform":sys.platform}}


def validate(node, kind, value):
    result = subprocess.run([node,"scripts/validate-topology-matrix.mjs",kind],cwd=ROOT,input=json.dumps(value),capture_output=True,text=True,encoding="utf-8",timeout=15)
    if result.returncode:
        raise ValueError("Invalid matrix " + kind)


def run(suite, node, selected):
    observations, unavailable = {}, {}
    runtimes = {"typescript":node,"python":sys.executable}
    for host in LANGUAGES:
        for peer in LANGUAGES:
            pair = (host,peer)
            if pair not in selected: continue
            if not runtimes[host] or not runtimes[peer]:
                unavailable[pair] = "Required language runtime is unavailable."
                continue
            adapter = "scripts/topology-adapter.mjs" if host == "typescript" else "scripts/topology_adapter.py"
            server = ROOT / ("scripts/evaluation-server.mjs" if peer == "typescript" else "scripts/evaluation_server.py")
            print(f"Executing {host} host -> {peer} MCP child (offline).",file=sys.stderr,flush=True)
            try:
                process = subprocess.run([runtimes[host],adapter,runtimes[peer],str(server)],cwd=ROOT,capture_output=True,text=True,encoding="utf-8",timeout=90)
                entries = json.loads(process.stdout) if process.returncode == 0 else None
                validate(node,"adapter",entries)
                observations[pair] = index_observations(entries,suite["cases"])
            except (OSError,subprocess.SubprocessError,ValueError):
                observations[pair] = None
    return observations, unavailable


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output",type=Path,help="Write the JSON manifest here instead of stdout.")
    parser.add_argument("--check",action="store_true",help="Exit 0 only for all 48 expected Topology B fixture passes; other topologies remain unavailable.")
    parser.add_argument("--host",choices=LANGUAGES,help="Omit other host combinations as skipped.")
    parser.add_argument("--peer",choices=LANGUAGES,help="Omit other peer combinations as skipped.")
    args = parser.parse_args()
    node = shutil.which("node")
    if not node:
        parser.error("Node >=22 is required for shared-schema validation (no execution claimed).")
    if int(subprocess.check_output([node,"--version"],text=True).strip().lstrip("v").split(".")[0]) < 22:
        parser.error("Node >=22 is required; the selected runtime is unsupported (no execution claimed).")
    suite = json.loads((ROOT/CORPUS).read_text(encoding="utf-8"))
    validate(node,"suite",suite)
    before = provenance(node)
    selected = {(h,p) for h in LANGUAGES for p in LANGUAGES if (not args.host or h == args.host) and (not args.peer or p == args.peer)}
    observations, unavailable = run(suite,node,selected)
    # Do not stamp results with a source snapshot that changed while processes ran.
    if provenance(node) != before:
        observations = {pair:None for pair in selected}
    report = assemble(suite,before,observations,unavailable,selected)
    validate(node,"report",report)
    output = json.dumps(report,indent=2,ensure_ascii=False)+"\n"
    if args.output:
        args.output.parent.mkdir(parents=True,exist_ok=True)
        args.output.write_text(output,encoding="utf-8")
    else:
        print(output,end="")
    print(json.dumps({"scopePassed":report["scopePassed"],"fullConformance":False,**report["summary"]}),file=sys.stderr)
    return exit_code(report,args.check)


if __name__ == "__main__":
    raise SystemExit(main())
