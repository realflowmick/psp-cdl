# SPDX-License-Identifier: Apache-2.0
"""Compare PSP-EXFIL-0.1 output across languages, including stores written by one language and read by the other."""
import json
import sqlite3
import subprocess
import uuid
from pathlib import Path
from exfiltration_fixtures import SUITE, assess_existing, open_store, primitives, project, run_case, sqlite_vec_path

ROOT = Path(__file__).resolve().parents[1]
RUN = ROOT / ".artifacts" / ("exfil-parity-" + uuid.uuid4().hex[:10])
RUN.mkdir(parents=True)


def node(source):
    code = "import * as f from './scripts/exfiltration-fixtures.mjs'; const out=await (async()=>{" + source + "})(); console.log(JSON.stringify(out));"
    peer = subprocess.run(["node", "--input-type=module", "-e", code], cwd=ROOT, check=True, capture_output=True, text=True, encoding="utf-8")
    return json.loads(peer.stdout)


def same(label, py, ts):
    if py != ts:
        raise SystemExit(label + ": exfiltration parity mismatch\n" + ascii(py)[:2000] + "\n" + ascii(ts)[:2000])


def rows(path):
    db = sqlite3.connect(path)
    try:
        return {table: db.execute(f"SELECT * FROM {table} ORDER BY 1, 2").fetchall() for table in ("exfil_meta", "exfil_section", "exfil_chunk", "exfil_shingle")}
    finally:
        db.close()


vec = sqlite_vec_path() is not None and node("return await f.sqliteVecPath()!==null;")
cases = [c for c in SUITE["cases"] if vec or c["vector"] != "sqlite-vec"]
skipped = len(SUITE["cases"]) - len(cases)
same("primitives", primitives(), node("return f.primitives();"))
outputs = 0
for case in cases:
    cid = json.dumps(case["id"])
    find = f"const c=f.suite.cases.find(c=>c.id==={cid});"
    py_path, ts_path = RUN / ("py-" + case["id"] + ".sqlite"), RUN / ("ts-" + case["id"] + ".sqlite")
    py = run_case(case, str(py_path))
    ts = node(find + f"return await f.runCase(c,{json.dumps(str(ts_path))});")
    same(case["id"] + " fresh stores", py, ts)
    for output, assessment in zip(case["outputs"], py["assessments"]):
        if project(assessment, output["expected"]) != output["expected"]:
            raise SystemExit(case["id"] + "/" + output["id"] + ": expectation not met " + ascii(project(assessment, output["expected"])))
    same(case["id"] + " stored rows", rows(py_path), rows(ts_path))
    same(case["id"] + " Python store read by TypeScript", py["assessments"], node(find + f"return await f.assessExisting(c,{json.dumps(str(py_path))});"))
    same(case["id"] + " TypeScript store read by Python", ts["assessments"], assess_existing(case, str(ts_path)))
    outputs += len(case["outputs"])

modes = 0
if vec:
    vec_case = next(c for c in SUITE["cases"] if c["vector"] == "sqlite-vec")
    portable_case = next(c for c in SUITE["cases"] if c["embedder"] == "hash" and c["vector"] == "portable")
    path = RUN / "mode-interchange.sqlite"
    run_case(vec_case, str(path))
    find = f"const c=f.suite.cases.find(c=>c.id==={json.dumps(vec_case['id'])});"
    same("vec0 store read in portable mode", run_case(portable_case)["assessments"], node(find + f"return await f.assessExisting(c,{json.dumps(str(path))},'portable');"))
    extra = {"application": "claims-intake", "sectionType": "context", "sessionId": "session-2002", "label": "late-context",
             "text": "Claimant Ira Castellanos, claim HM-9921-0057, reported hail damage to the north roof on 2026-09-02."}
    node(find + f"const s=await f.openStore(c,{json.dumps(str(path))},'portable'); try {{ return await s.protect({json.dumps(extra)}); }} finally {{ s.close(); }}")
    store = open_store(vec_case, str(path))
    try:
        late = store.assess({"application": "claims-intake", "text": extra["text"]})
    finally:
        store.close()
    if late["vector"] != "sqlite-vec" or late["sections"][0]["label"] != "late-context" or late["sections"][0]["semantic"]["disposition"] != "leak":
        raise SystemExit("A portable write was not indexed after the sqlite-vec rebuild: " + ascii(late))
    modes = 2

print(f"{len(cases)} shared exfiltration cases ({outputs} outbound texts) agree across languages, including stored rows and stores read by the other language"
      + (f"; {modes} vec0/portable interchange checks passed" if modes else "")
      + (f"; {skipped} sqlite-vec case(s) unsupported here" if skipped else "")
      + ". Signals are draft heuristics, not detection-effectiveness evidence.")
