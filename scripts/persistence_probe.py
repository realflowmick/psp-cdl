# SPDX-License-Identifier: Apache-2.0
import json
import os
from pathlib import Path
import sqlite3
import sys
import time
from persistence_fixtures import SECRET, run_fixture
from psp_cdl_api_server.persistence import WorkflowStore, StoreError
from psp_cdl_api_server.sqlite import SqliteBackend

sys.stdin.reconfigure(encoding="utf-8")
sys.stdout.reconfigure(encoding="utf-8")
path, options = sys.argv[1], json.load(sys.stdin)
if options.get("mode") == "fixture":
    print(json.dumps(run_fixture(path)))
elif options.get("mode") == "crashUncommitted":
    db = sqlite3.connect(path, isolation_level=None)
    db.execute("PRAGMA cache_size=1")
    db.execute("PRAGMA cache_spill=ON")
    db.execute("BEGIN IMMEDIATE")
    db.execute("UPDATE psp_records SET body=?", (json.dumps({"uncommitted": "x" * 65536}),))
    os._exit(0)
else:
    backend = SqliteBackend(path, options.get("epoch", "peer-epoch"), lambda: options.get("now", 100))
    def permit(*_):
        if barrier := options.get("barrier"):
            Path(barrier["ready"]).write_text("ready", encoding="utf-8")
            deadline = time.monotonic() + 15
            while not Path(barrier["go"]).exists():
                if time.monotonic() > deadline:
                    raise RuntimeError("barrier timeout")
                time.sleep(0.02)
        return True
    store = WorkflowStore(backend, resume_secret=SECRET, authorize_persistence=permit)
    try:
        result = {"result": store.execute(options["actor"], options["command"])}
    except StoreError as exc:
        result = {"error": exc.code}
    if options.get("crashAfterCommit"):
        print(json.dumps(result, ensure_ascii=False), flush=True)
        os._exit(0)
    backend.close()
    print(json.dumps(result, ensure_ascii=False))
